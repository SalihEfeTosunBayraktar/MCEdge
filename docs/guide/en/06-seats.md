# Seatable blocks

Chairs, benches and sofas: players right-click the block and sit on it. No procedure or code is needed.

## 1. Turn it on

Open the block and go to the **Seat** page. Tick **Seatable**. The preview on the right shows the block with a sitting player on each seat, as the game seats them.

## 2. Place the seats

| What | How |
| --- | --- |
| Add a seat | Click the top of the block in the preview. |
| Move a seat | Drag its marker (the white disc). It moves by whole pixels; turn **Snap** off or hold Shift to move freely. |
| Turn a seat | Drag the arrow's tip, or select the seat and press R (Shift+R turns back). The grey arrow under the block marks its front. |
| Remove a seat | Select it and press Delete. |
| Several seats | Set the number under the preview and press **Spread**: the seats spread evenly along the long side of the block. |
| Lie down | Set the seat's **Pose** to **Lie down**: the player lies on their back, head towards the arrow, the middle of the body on the point. Good for a sofa's long side. There is no bed: nobody sleeps and the night does not pass. A lying player takes the length of a body, so seats under them stay free until they stand up, and a lying spot is not given while someone sits there; give each arm of an L sofa its own lying spot. |

The **Seats** rows in the form hold the same values (pixels, 16 = one block; facing in degrees from the front) and can be typed in.

## 3. Sit height

**Automatic** puts each seat on the top of the block's boxes under it (Bounding boxes page): a seat box 8 pixels high gives a sit height of 0.5 blocks; the green lines in the preview are those boxes. **Manual** uses each seat's own height.

## 4. Rules

- **Only with an empty hand**: a player holding something uses it on the block as usual instead of sitting.
- **Stand up at**: on top of the block, in front of the seat, or where the player stood before.
- Sneaking stands the player up. Breaking or replacing the block stands everyone up. A taken seat refuses.
- A block that faces the player when placed turns its seats with it.

## 5. Furniture bigger than one block

Sofas and tall chairs span several blocks. On the **Bounding boxes** page tick **Spans several blocks** and draw the boxes
over the whole piece: boxes may go below 0 and above 16 (16 = one block; a sofa two blocks wide and three deep is x -16 to
16, z -16 to 32). Every block the boxes touch becomes part of the piece; the preview outlines them in blue.

- Placing it needs all of those blocks free; it turns to face the player like a one-block piece.
- Breaking any part breaks the whole piece, and it drops once. Pistons cannot push it.
- Seats use the same pixels, so a sofa's seats can lie in any of its blocks; clicking any part sits on the nearest free seat.

## 6. From procedures

The **Entity** category has **make ... sit on the block at x y z** (any block: a seatable block's free seat, any other block on its top), **... is sitting** and **make ... stand up**.

## 7. Build and run

Build and run: right-click the block with an empty hand. Every engine uses the same shared seat code and reads the seats from the mod's data, so adding more seatable blocks adds no code.
