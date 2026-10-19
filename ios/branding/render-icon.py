"""Render branding/app-icon.svg to the 1024 px App Store icon without an alpha channel.

Needs rsvg-convert (librsvg). Usage: python3 ios/branding/render-icon.py
"""
import struct
import subprocess
import sys
import zlib
from pathlib import Path

here = Path(__file__).resolve().parent
svg = here / 'app-icon.svg'
out = here.parent / 'VPass/Assets.xcassets/AppIcon.appiconset/AppIcon.png'


def chunks(data):
	pos = 8
	while pos < len(data):
		length = struct.unpack('>I', data[pos:pos + 4])[0]
		yield data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
		pos += 12 + length


def unfilter(raw, width, height, bpp):
	stride = width * bpp
	rows, prev = [], bytearray(stride)
	for y in range(height):
		kind = raw[y * (stride + 1)]
		line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
		for i in range(stride):
			a = line[i - bpp] if i >= bpp else 0
			b = prev[i]
			c = prev[i - bpp] if i >= bpp else 0
			if kind == 1:
				line[i] = (line[i] + a) & 255
			elif kind == 2:
				line[i] = (line[i] + b) & 255
			elif kind == 3:
				line[i] = (line[i] + (a + b) // 2) & 255
			elif kind == 4:
				p = a + b - c
				pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
				line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
		rows.append(line)
		prev = line
	return rows


png = subprocess.run(['rsvg-convert', '-w', '1024', '-h', '1024', str(svg)], check=True, capture_output=True).stdout
width = height = 0
idat = b''
for kind, body in chunks(png):
	if kind == b'IHDR':
		width, height, depth, color = struct.unpack('>IIBB', body[:10])
		if depth != 8 or color not in (2, 6):
			sys.exit(f'unexpected PNG format {depth}/{color}')
	elif kind == b'IDAT':
		idat += body
if color == 2:
	# Already RGB without alpha.
	out.write_bytes(png)
	print(f'wrote {out}')
	sys.exit(0)
rows = unfilter(zlib.decompress(idat), width, height, 4)
rgb = b''.join(b'\x00' + bytes(v for i, v in enumerate(row) if i % 4 != 3) for row in rows)


def chunk(kind, body):
	return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)


out.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
	+ chunk(b'IDAT', zlib.compress(rgb, 9)) + chunk(b'IEND', b''))
print(f'wrote {out}')
