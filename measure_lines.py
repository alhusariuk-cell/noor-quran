import json, os, re
from PIL import ImageFont, ImageDraw, Image

FONT_PATH = '/home/ubuntu/noor-quran/public/fonts/UthmanicHafs.woff2'
FONT_SIZE = 18
MUSHAF_DIR = '/home/ubuntu/noor-quran/public/mushaf'

def strip_waqf(t):
    return re.sub(r'[\u06DF-\u06E8\u06EA-\u06ED\u0600-\u0605]', '', t)

try:
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
except Exception as e:
    print(f"Font load error: {e}")
    exit(1)

# Use a dummy image for measurement
img = Image.new('RGB', (800, 200))
draw = ImageDraw.Draw(img)

max_width = 0
max_line = ''
max_page = 0

files = sorted(f for f in os.listdir(MUSHAF_DIR) if f.endswith('.json'))

for fname in files:
    page_num = int(fname.replace('page-', '').replace('.json', ''))
    with open(os.path.join(MUSHAF_DIR, fname)) as f:
        data = json.load(f)
    for line in data['lines']:
        if line['type'] != 'text':
            continue
        words = line.get('words', [])
        text = strip_waqf(
            ' '.join(w['word'] for w in words) if words else (line.get('text') or '')
        )
        if not text:
            continue
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        if w > max_width:
            max_width = w
            max_line = text
            max_page = page_num

print(f"Max text width: {max_width}px")
print(f"Page: {max_page}")
print(f"Line: {max_line[:60]}")
print(f"\nDisplay width: 576px")
col = (max_width // 10 + 1) * 10
margin = (576 - col) / 2
print(f"Suggested column width: {col}px")
print(f"Margin each side: {margin:.1f}px")
