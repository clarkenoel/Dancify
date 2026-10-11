"""Build small runtime sprites; originals/pivots stay in assets/pictograms.

Run with pipeline/.venv/bin/python web/scripts/build-pictograms.py.
Pillow is already part of the pipeline environment, not a new web dependency.
"""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
source = root / 'assets/pictograms'
rig = json.loads((source / 'rig.json').read_text())
for character in ['lenny', 'human']:
    destination = root / f'web/src/assets/pictograms/{character}'
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for bone in rig['characters'][character]['bones']:
        sprite = next(iter(bone['variants'].values()))
        original = source / sprite['file']
        with Image.open(original) as image:
            region = sprite['region']
            bounds = image.crop(region).getchannel('A').getbbox()
            if bounds is None:
                raise ValueError(f"Empty sprite: {bone['id']}")
            crop = [bounds[0] + region[0], bounds[1] + region[1],
                    bounds[2] + region[0], bounds[3] + region[1]]
            small = image.crop(crop)
            small.thumbnail((256, 256), Image.Resampling.LANCZOS)
            small.save(destination / f"{bone['id']}.png", optimize=True)
            manifest[bone['id']] = {'crop': crop, 'size': list(small.size),
                                   'source': sprite['file'],
                                   'sourceSha256': hashlib.sha256(original.read_bytes()).hexdigest()}
    (destination / 'sprites.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Generated {len(manifest)} {character} sprites; originals unchanged.')
print('Next: node web/scripts/bake-pictogram-colors.mjs')
