#!/usr/bin/env python3
"""Train the doodle-board NSFW sketch classifier ("doodle guard").

A tiny CNN that scores a doodle's strokes for phallic content, exported as
raw weights (assets/doodle-guard.bin) and run in the browser by hand-rolled
JS in index.html at pin time.

Data:
  positives  quickdraw-appendix (Moniker, CC-BY 4.0)
             https://github.com/studiomoniker/quickdraw-appendix
  negatives  Google Quick, Draw! simplified drawings (CC-BY 4.0), a
             diverse slice of categories including lookalikes (rocket-ish
             shapes, cactus, mushroom, lollipop, syringe, banana, ...)

Both datasets store a drawing as [[xs, ys], ...] per stroke, coords 0-255.
The browser rasterizes site strokes the same way this script rasterizes
training strokes: bbox-normalized, centered in 64x64, ~3px round lines.

Usage:
  python train.py --data DIR          # DIR holds penis-simplified.ndjson
                                      # and negatives/*.ndjson
  python train.py --data DIR --out ../../assets/doodle-guard.bin
"""

import argparse
import io
import json
import math
import random
import struct
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageDraw, ImageFilter
from torch.utils.data import DataLoader, Dataset

SIZE = 64          # raster resolution, must match the JS rasterizer
MARGIN = 6         # px of empty border at scale 1, must match the JS
RUNTIME_WIDTH = 3  # line width the JS rasterizer uses


# --- rasterization ------------------------------------------------------

def rasterize(strokes, rot_deg=0.0, width=RUNTIME_WIDTH, margin=MARGIN,
              jitter=(0.0, 0.0), blur=0.0):
    """strokes: list of [xs, ys] -> float32 (SIZE, SIZE) in [0, 1]."""
    pts = [np.array(s, dtype=np.float64).T for s in strokes]  # (n, 2) each
    allp = np.concatenate(pts)
    if rot_deg:
        c = allp.mean(axis=0)
        a = math.radians(rot_deg)
        m = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
        pts = [(p - c) @ m.T + c for p in pts]
        allp = np.concatenate(pts)

    lo, hi = allp.min(axis=0), allp.max(axis=0)
    span = float(max(hi[0] - lo[0], hi[1] - lo[1], 1e-6))
    scale = (SIZE - 2 * margin) / span
    # center the bbox, then optional sub-pixel jitter
    off = (SIZE - (hi - lo) * scale) / 2 - lo * scale + np.array(jitter)

    img = Image.new('L', (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(img)
    r = width / 2
    for p in pts:
        q = p * scale + off
        xy = [tuple(v) for v in q]
        if len(xy) > 1:
            draw.line(xy, fill=255, width=width, joint='curve')
        for end in (q[0], q[-1]):
            draw.ellipse([end[0] - r, end[1] - r, end[0] + r, end[1] + r],
                         fill=255)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(img, dtype=np.float32) / 255.0


# --- data ---------------------------------------------------------------

def load_split(data_dir):
    """Parse ndjson files -> (train, val) lists of (strokes, label)."""
    def rows(path, label):
        out = []
        with open(path) as f:
            for line in f:
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                strokes = [s for s in d.get('drawing', [])
                           if len(s) == 2 and len(s[0]) > 0]
                if strokes:
                    out.append((strokes, label))
        return out

    pos = rows(Path(data_dir) / 'quickdraw-appendix/penis-simplified.ndjson', 1)
    neg = []
    for p in sorted((Path(data_dir) / 'negatives').glob('*.ndjson')):
        neg.append((p.stem, rows(p, 0)))
    n_neg = sum(len(r) for _, r in neg)
    print(f'positives: {len(pos)}   negatives: {n_neg} '
          f'({len(neg)} categories)')

    rng = random.Random(7)
    train, val = [], []
    for sample_set in [pos] + [r for _, r in neg]:
        for row in sample_set:
            (val if rng.random() < 0.1 else train).append(row)
    rng.shuffle(train)
    return train, val


class Sketches(Dataset):
    def __init__(self, rows, augment):
        self.rows = rows
        self.augment = augment

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        strokes, label = self.rows[i]
        if self.augment:
            rng = random.Random()
            if rng.random() < 0.5:  # hflip via mirroring xs
                strokes = [[[255 - x for x in xs], ys] for xs, ys in strokes]
            img = rasterize(
                strokes,
                rot_deg=rng.uniform(-180, 180),
                width=rng.choice([2, 3, 3, 4]),
                margin=rng.uniform(4, 10),
                jitter=(rng.uniform(-3, 3), rng.uniform(-3, 3)),
                blur=rng.uniform(0, 0.7),
            )
        else:
            # mirror the runtime rasterization (canvas AA ~ slight blur)
            img = rasterize(strokes, blur=0.3)
        return torch.from_numpy(img)[None], torch.tensor(float(label))


# --- model --------------------------------------------------------------

class Net(nn.Module):
    CHANNELS = [1, 16, 32, 64, 64]

    def __init__(self):
        super().__init__()
        layers = []
        chans = self.CHANNELS
        for cin, cout in zip(chans, chans[1:]):
            layers += [nn.Conv2d(cin, cout, 3, padding=1),
                       nn.BatchNorm2d(cout),
                       nn.ReLU(inplace=True),
                       nn.MaxPool2d(2)]
        self.features = nn.Sequential(*layers)      # -> (64, 4, 4)
        self.head = nn.Linear(chans[-1], 1)

    def forward(self, x):
        x = self.features(x).mean(dim=(2, 3))       # global average pool
        return self.head(x)[:, 0]


# --- export -------------------------------------------------------------

def fold_bn(conv, bn):
    """Fold BatchNorm into the conv's weight/bias."""
    g = bn.weight / torch.sqrt(bn.running_var + bn.eps)
    w = conv.weight * g[:, None, None, None]
    b = (conv.bias if conv.bias is not None else 0) * g \
        + bn.bias - bn.running_mean * g
    return w, b


def export(model, out_path):
    model.eval()
    tensors, layers = [], []
    mods = list(model.features)
    for i in range(0, len(mods), 4):
        conv, bn = mods[i], mods[i + 1]
        w, b = fold_bn(conv, bn)
        tensors += [w, b]
        layers.append({'type': 'conv', 'in': conv.in_channels,
                       'out': conv.out_channels, 'k': 3})
    tensors += [model.head.weight, model.head.bias]
    layers.append({'type': 'dense', 'in': model.head.in_features, 'out': 1})

    header = json.dumps({'v': 1, 'size': SIZE, 'layers': layers}).encode()
    buf = io.BytesIO()
    buf.write(b'DGN1')
    buf.write(struct.pack('<I', len(header)))
    buf.write(header)
    for t in tensors:
        buf.write(t.detach().cpu().numpy().astype('<f4').tobytes())
    Path(out_path).write_bytes(buf.getvalue())
    print(f'wrote {out_path} ({buf.tell() / 1024:.0f} KB)')


# --- training -----------------------------------------------------------

def evaluate(model, loader, device):
    model.eval()
    probs, labels = [], []
    with torch.no_grad():
        for x, y in loader:
            p = torch.sigmoid(model(x.to(device)))
            probs.append(p.cpu())
            labels.append(y)
    p = torch.cat(probs).numpy()
    y = torch.cat(labels).numpy()
    order = np.argsort(p)
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(len(p))
    npos, nneg = y.sum(), (1 - y).sum()
    auc = (ranks[y == 1].sum() - npos * (npos - 1) / 2) / (npos * nneg)
    print(f'  val AUC {auc:.4f}')
    for t in (0.5, 0.8, 0.9, 0.95):
        pred = p >= t
        tp = (pred & (y == 1)).sum()
        fp = (pred & (y == 0)).sum()
        prec = tp / max(tp + fp, 1)
        rec = tp / npos
        print(f'  @{t:.2f}  precision {prec:.4f}  recall {rec:.4f}  '
              f'false-pos {fp}/{int(nneg)}')
    return auc, p, y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--out', default='doodle-guard.bin')
    ap.add_argument('--epochs', type=int, default=8)
    ap.add_argument('--batch', type=int, default=128)
    ap.add_argument('--workers', type=int, default=4)
    args = ap.parse_args()

    device = ('mps' if torch.backends.mps.is_available() else 'cpu')
    train_rows, val_rows = load_split(args.data)
    train_dl = DataLoader(Sketches(train_rows, True), batch_size=args.batch,
                          shuffle=True, num_workers=args.workers,
                          persistent_workers=args.workers > 0)
    val_dl = DataLoader(Sketches(val_rows, False), batch_size=256,
                        num_workers=args.workers)

    model = Net().to(device)
    n_par = sum(p.numel() for p in model.parameters())
    print(f'device {device}, params {n_par}')
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs)
    lossf = nn.BCEWithLogitsLoss()

    best = (0.0, None)
    for epoch in range(args.epochs):
        model.train()
        tot = n = 0
        for x, y in train_dl:
            x, y = x.to(device), y.to(device)
            opt.zero_grad()
            loss = lossf(model(x), y)
            loss.backward()
            opt.step()
            tot += loss.item() * len(y)
            n += len(y)
        sched.step()
        print(f'epoch {epoch + 1}/{args.epochs}  loss {tot / n:.4f}')
        auc, _, _ = evaluate(model, val_dl, device)
        if auc > best[0]:
            best = (auc, {k: v.cpu().clone()
                          for k, v in model.state_dict().items()})

    print(f'best val AUC {best[0]:.4f}')
    model.load_state_dict(best[1])
    model.cpu()
    torch.save(model.state_dict(), Path(args.data) / 'doodle-guard.pt')
    export(model, args.out)

    # parity vectors so the JS forward pass can be checked bit-for-bit-ish
    vec = []
    model.eval()
    for strokes, label in [val_rows[i] for i in (0, len(val_rows) // 2, -1)]:
        img = rasterize(strokes, blur=0.3)
        with torch.no_grad():
            prob = torch.sigmoid(
                model(torch.from_numpy(img)[None, None])).item()
        vec.append({'label': label, 'prob': prob,
                    'input': [round(float(v), 5) for v in img.flatten()]})
    tv = Path(args.data) / 'test-vectors.json'
    tv.write_text(json.dumps(vec))
    print(f'wrote {tv}')


if __name__ == '__main__':
    main()
