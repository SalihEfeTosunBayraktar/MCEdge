# Add a bubble

A bubble is a speech bubble shown above a player's head: a background, an icon, a short caption and animations for showing and hiding. You design it like a small overlay and show it from a procedure.

## 1. Create the bubble

**New element > Bubble**, give it an id (`trade_offer`). The canvas on the right shows the bubble above a player head as it looks in the game, and updates as you change the form.

## 2. Design it

| Part | Fields |
| --- | --- |
| Background | Empty for the built-in speech bubble, or any project PNG: stretched, or **9-slice** so its corners keep their size when the bubble is wider. |
| Icon | Any project PNG and its size. Centred above the tail by default; drag it on the canvas to place it freely. |
| Caption | Text above the bubble, its colour, shadow and size. Write `{text}` where the procedure's caption goes (`Trade: {text}`). |
| Layout | Width and height in pixels (32 pixels are 0.6 blocks), size in the world, extra height above the head. |
| Behaviour | How it **appears** and **disappears** (any combination of fade, grow or shrink, slide up or down; each with a length in ticks and an easing), the **active time** in ticks (0: until cleared), a sound. |

An image that is a strip of square frames with a `.png.mcmeta` beside it plays as an animation, on the canvas and in the game, in the playback mode set in the texture editor (loop, play once and hold, ping-pong). **Name tag shown** moves the bubble as the game does when the name tag is visible.

### The timeline

Under the canvas, a timeline shows the three parts of the bubble's life: **Appear**, **Hold** and **Disappear**. **Play** runs it once (**Loop** repeats it), the slider scrubs to any tick, and the canvas shows the bubble exactly as the game draws it at that moment. The active time is how long the bubble stays from the moment it is shown until it starts to disappear (the appear time counts); with 0 ("until cleared") the hold part is only a short example. Bubbles saved with the old single animation open with the same look for appearing and disappearing.

## 3. Show it from a procedure

In a procedure, the **Bubbles** category has **show bubble ... above ... with caption ... for ... ticks**: pick the bubble, the player, a caption (it fills `{text}`) and a duration (-1: the bubble's own duration, 0: until cleared). **clear the bubble above** removes it, and the bubble plays its disappear transition instead of vanishing. The duration decides the active time for this one bubble; the bubble's own active time is used when it is -1.

## 4. Build and run

Build and run the client: the bubble appears above the player for every player in the same dimension, on every engine. Nothing else is needed: the build turns each bubble into data and one renderer draws them all.

The older icon blocks (**show bubble *icon* above ...**) keep working; they show the built-in bubble with an icon from `textures/bubbles/`. A bubble element with the id `default` replaces that built-in bubble.
