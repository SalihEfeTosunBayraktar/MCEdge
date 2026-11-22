"""Q276: the 26.3 game screenshot's GUI next to the editor canvas, both at 4 screen pixels per GUI pixel.
usage: py -3 tools/codegen-test/textshot/compare.py  (after run.sh and tools/ui-test/gui-text-preview.ts)"""
import json
from PIL import Image

W, H = 176, 166
game = Image.open("design/276/game-26.3-scale2.png").convert("RGB")
scale = 2
left, top = (game.width // scale - W) // 2 * scale, (game.height // scale - H) // 2 * scale
game = game.crop((left, top, left + W * scale, top + H * scale)).resize((W * 4, H * 4), Image.NEAREST)
st = json.load(open("design/276/editor-stage.json"))
editor = Image.open("design/276/editor-dark.png").convert("RGB")
editor = editor.crop((round(st["x"]), round(st["y"]), round(st["x"] + st["width"]), round(st["y"] + st["height"]))).resize((W * 4, H * 4), Image.NEAREST)
out = Image.new("RGB", (W * 8 + 16, H * 4), (30, 30, 30))
out.paste(game, (0, 0))
out.paste(editor, (W * 4 + 16, 0))
out.save("design/276/side-by-side.png")
print("design/276/side-by-side.png  left: game 26.3, right: editor")
