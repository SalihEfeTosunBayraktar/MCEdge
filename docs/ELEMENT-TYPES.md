# Element type definitions

Every mod element type (Block, Item, Armor, Procedure, ...) is described by data, not code:
`element-types/<id>/type.json`. The editor builds its forms from it, the core validates and stores
elements with it, and engines generate code from the stored values. Adding a field means editing
JSON plus the engine templates that use it.

## type.json

| key | meaning |
| --- | --- |
| `id` | Type id, singular snake_case (`block`, `living_entity`). |
| `folder` | Folder under `elements/` holding one JSON file per element (`blocks`). |
| `name`, `description` | Shown in the type picker and on tiles. Our own wording. |
| `icon`, `shortcut` | Icon id and the single letter used in the New element popup. |
| `langKey` | Lang key prefix for the element's display name (`block`, `item`, `entity`, ...) or `null`. |
| `mcreator` | Name of the matching MCreator element type, for importing workspaces. |
| `pages` | Ordered editor pages: `{ id, title, groups: [{ title, fields: [...] }] }`. |

## Fields

Common keys: `key` (property name in the element JSON), `type`, `label`, `help`, `default`,
`required`, `showIf` (see below), `mcreator` (the MCreator field name, for import).

| type | stored value | extra keys |
| --- | --- | --- |
| `text`, `multiline` | string | `maxLength`, `pattern` |
| `integer`, `number` | number | `min`, `max`, `step`, `warnAbove`, `warnBelow` |
| `boolean` | boolean | |
| `select` | the chosen option's `value` (string or number, stored exactly as written) | `options: [{ value, label }]`, `elementTypes` |
| `multiselect` | array of option values | `options`, `elementTypes` |
| `texture` | project PNG path | `textureKind`: block, item, entity, armor, screen, particle, effect, painting, other |
| `model` | model id or path | `modelKinds` |
| `sound` | sound id (`minecraft:...` or mod) | |
| `color` | `#rrggbb`, or `""` for the vanilla default | |
| `item`, `block`, `entity`, `biome`, `effect`, `enchantment`, `potion`, `particle`, `dimension`, `damage_type`, `villager_profession`, `structure`, `attribute`, `sound` | registry id (vanilla or this mod) | `allowTags` |
| `tag` | tag id (`#minecraft:logs`) | `tagKind` |
| `element` | id of an element of this mod (`""` for none); string[] with `multiple` | `elementTypes`, `multiple`, `options`, `allowCustom` |
| `procedure` | procedure element id (or empty) | `trigger`: what calls it, `dependencies`: values it receives, `returns` |
| `range` | `{ min, max }` | `min`, `max`, `step` |
| `vector` | `{ x, y, z }` | |
| `list` | array of objects | `fields`: sub-field definitions, `minItems`, `maxItems` |
| `map` | object of key to value | `keyField`, `valueField`; `modelField` (a sibling `model` field) makes it the texture slots of that model, listed by the editor, e.g. the block's `customModelTextures` |
| `recipe_grid` | 3x3 or 2x2 slots of item refs | `size` |
| `gui_layout` | GUI widgets (dedicated editor): array of `{ kind, name?, x, y, ... }`, see below | |
| `blockly` | procedure block tree (dedicated editor) | |

Selects store integers when MCreator does (`renderType`, `rotationMode`, silk touch mode): give the options
numeric `value`s and a numeric `default`; the editor and validator compare values by type, so `10` and `"10"`
differ.

`min` and `max` are hard limits: a value outside them is an error and blocks the build. `warnAbove` and `warnBelow`
are soft limits for values that are legal but unusual (durability above MCreator's 128000 cap): such a value is an
info problem the user can ignore (see Problems in docs/MCP.md, `src/ir/problems.ts`).

### References to this mod's elements

`element` picks elements of this mod by type: `"elementTypes": ["gui"]` lists the project's GUI elements.
`options` adds fixed choices next to them (`"No parent: root"`, `minecraft:water`); `allowCustom: true` also
accepts any typed resource location (vanilla advancements). A `select` or `multiselect` with `elementTypes` offers its
options plus those elements, which is how creative tab pickers list vanilla tabs and the mod's `creative_tab` elements.
Registry fields (`item`, `block`, `entity`, ...) already accept this mod's elements and need no `elementTypes`.

### GUI widgets

A `gui_layout` value lists widgets with positions relative to the GUI's top left corner. `name` (optional) names the
widget's lang key `gui.<modid>.<gui>.<name>`.

| kind | keys |
| --- | --- |
| `label` | `text`, `color` (`#rrggbb`), `textProcedure` (text shown instead, read every frame on the client; a procedure with a server-side block runs on the server, the menu sends the text when it changes), `condition`, `textScale` (text size, 1 = normal; scaled around x, y), `z`, `background` (`#rrggbb`: a box behind the text, the text's width and 8 pixels high, scaled with it; KUYRUK 182), `backgroundOpacity` (0-100, default 50), `backgroundPadding` (0-8 pixels around the text, default 1), `align` (`left` default, `center`, `right`: x is the text's left edge, centre or right edge, kept as the text changes; KUYRUK 183) |
| `button` | `width`, `height`, `text`, `procedure` (runs on the server with x, y, z, world, entity), `condition`, `textScale` (text size, scaled around the button's centre) |
| `image_button` | `width`, `height`, `image` (normal state), `hoverImage` (hover state), `procedure`, `condition`; without `hoverImage` (or with `hoverImage` naming the same file) the old layout: `image` holds the normal state above the hover state, twice the height. The editor canvas shows the hover state under the mouse, and plays a `.mcmeta` animation of the two textures |
| `toggle_button` | `width`, `height`, `image` (off), `hoverImage` (off, mouse over it), `onImage` (on), `onHoverImage` (on, mouse over it), `stateProcedure` (logic, read every frame on the client: on while true), `procedure` (click, on the server; usually flips what `stateProcedure` reads), `condition`. A missing texture falls back to the nearest one set; a texture with a `.mcmeta` animation plays |
| `text_field` | `width`, `height`, `text` (hint) |
| `checkbox` | `text`, `checked` |
| `image` | `image` (project PNG), `width`, `height` (default: the image size, one frame of an animation), `condition`, `z`. A vertical strip with a `.mcmeta` animation (or `animated`, with `frameTime` ticks per frame and `frameCount` frames) plays one frame at a time, in the game and on the editor canvas |
| `state_image` | KUYRUK 186: `width`, `height` (default 16), `states` (one or more `{ image, frame, condition }`: each state its own picture, a `.mcmeta` animation playing; `frame` shows only that square frame of a vertical strip, still), `stateProcedure` (number, read on the client: the state's index from 0, kept inside the list; with `stateValue` `percent` 0-100 spread evenly over the states), without it the first state whose `condition` (logic) holds, a state without one always qualifies, none: nothing drawn; `updateTicks` (read once every N ticks, default 0: every frame), `restartAnimation` (an animated state starts from its first frame when it becomes the shown one), `condition`, `z`; overlays too. The editor lists the states with their previews, shows the chosen one (`previewState`, editor only) on the canvas and splits a strip into one state per frame |
| `slot` | `id` (inventory slot), `output` (no placing), `limit` (only this item), `locked` (no placing or taking), `lockCondition` (logic procedure: locked while it is true); x, y is the 18x18 frame |

`z` (image, state_image, label; integer -99 to 99, default 0) is the drawing order: higher draws on top, list order among equal
ones. Above 0 draws over slots, items and buttons; 0 and below keeps the normal place (images under buttons and items,
labels under items). Overlays (HUD) draw in z order too; a `state_image` takes part like an image.
Animated textures (Q229) play in the playback mode set in the texture editor (or `set_texture_animation mode`), stored
in the `.mcmeta`'s own `"mcedge": { "playback": ... }` section: `loop` (default), `hold_last`, `hold_first`,
`ping_pong`. A GUI `image` starts its animation as `animationStart` says: `open` (default, when the screen opens),
`always` (the game clock) or `procedure` (the `gui_image_restart` block, by the image's `name` or number; the first
frame until then). Toggle buttons play on the game clock, state images as `restartAnimation` says.
The overlay editor draws the game's own HUD (hotbar, XP bar, health, armor, hunger, crosshair) under the widgets at
vanilla's places on the 427x240 screen, as a guide only (Game HUD box in the side panel); it is not part of the element.
An old image with `overlay: true` and no `z` counts as 1.

Overlay widgets sit on a 427x240 canvas (`src/elements/overlayLayout.ts`, KUYRUK 170). On a screen of another size each
keeps its distance to the canvas point its `anchor` names (`top_left`, `top`, `top_right`, `left`, `center`, `right`,
`bottom_left`, `bottom`, `bottom_right`; unset: the overlay's `anchor` field, default `center`, the old placement). The
overlay's `scaleMode` sets how big a canvas pixel is: `gui` one GUI pixel (the player's GUI scale), `fixed` the GUI
scale in `fixedScale` whatever the player's setting, `fit` the canvas scaled to fill the screen by its narrower side.
The editor's Screen preview and the MCP tool `overlay_layout` place the widgets with the same rule.

Every GUI is a container menu with a screen (`src/generator/types/gui.ts`). Its slots use the inventory of the block
entity at the position it was opened for, the opening item's inventory, or a temporary container whose items go back
to the player on close. Buttons reach the server through vanilla's container button packet.

Session GUIs (Q205): `inventorySource: "session"` (default `block`) takes the slots from a shared server-side inventory
named by a text id instead (`inventorySize` slots, at least one past the highest slot id; extra slots are for
procedures). The procedure block `gui_open_session` opens the GUI for a player on a session id at the player's
position; players with the same id see and edit the same slots live, with no block (<Mod>GuiSessions,
`src/generator/guiSessions.ts`). Where block GUIs use x, y, z, procedures use `gui_session_id` (the session of the GUI
an entity has open) with the session blocks: `session_slot_item`, `session_set_slot_item`, `session_data_*` and
`session_set_data_*` (values kept with the session, like block data; the menu sends them to its player when they
change, so slot lock conditions and labels read them on the client too), `session_viewer_count` and
`gui_close_session` (closes it for everyone). A session menu runs `onOpen` on its first tick, once the player has it
open. When the last viewer closes, the session ends: `keepOnClose` slots are emptied and every other item goes to the
player who last added to its slot when online, else to the player closing it. A session GUI opened by a block or
`gui_open` works as an ordinary GUI.

Status bubbles (Q206, Q214, Q216, `src/generator/bubbles.ts`): a bubble is a `bubble` element designed like a small
overlay (guide: [Add a bubble](guide/en/05-bubbles.md)); its layout rules are `src/elements/bubbleLayout.ts`, shared by
the generator and the editor canvas. Fields: `background` (project PNG, "" = the built-in speech bubble),
`backgroundMode` (`plain` stretched, `nine_slice` with `sliceBorder` pixels kept at each edge), `icon` (any project
PNG), `iconSize`, `layout` (`center`: centred across, and between `padding` at the top and `tail` + `padding` at the
bottom; `free`: `iconX`, `iconY`), `caption` (`{text}` is replaced by the caption a procedure passes; without it a passed
caption replaces this one), `captionColor`, `captionShadow`, `captionScale` (1 = name-tag size), `width`, `height`
(bubble pixels; 32 pixels are 0.6 blocks at `scale` 1), `scale`, `offset` (extra blocks above the head), the show / hide
timing (Q228, below): `appear` / `disappear` with `appearTicks` / `disappearTicks` and `appearEasing` /
`disappearEasing`, `duration` (the active time) and `sound`. Images taller than wide whose height is a multiple of the
width are strips of square frames; the `<file>.png.mcmeta` gives the ticks per frame, its own frame list and times, and
its playback mode (Q229: `loop`, `hold_last`, `hold_first`, `ping_pong`, from the texture editor's Animation panel),
which the background and the icon play, in the game and in the editor (`interpolate` is ignored). A once mode counts
from when the bubble appeared.

Show / hide timing (Q228) is one general model, `src/elements/transitions.ts`, not bubble-only: an element has an
appear and a disappear transition and an active time. A transition has `effects` (any combination of `fade`, `scale`,
`slide_up`, `slide_down`; none = instant), a length in ticks (1-200) and an `easing` (`linear`, `ease_out`,
`ease_in_out`, `back` = overshoot and settle). Disappearing runs the appear curve backwards; `slide_up` moves up into
place when appearing and up and away when disappearing (`slide_down` the opposite), by half the bubble's height. The
active time (`duration`) is the ticks from showing until the disappear transition starts (the appear time counts);
0 = until cleared. The `bubble_show` block's duration overrides it (-1 = the bubble's own, 0 = until cleared), and
clearing a bubble (the clear block, a new bubble, the time running out) plays the disappear transition instead of
popping it out. Bubbles saved before Q228 (one `animation` of `pop` / `fade` / `none` over `animationTicks`) load as
the same look for appear and disappear. The build writes the timing into `bubbles.json` (`timing`) and one Java
helper, `<Mod>Transitions` (generated once per mod, with the frame lists of animated images), evaluates it for the
bubble renderer and the radial menu screen; the editor previews run the same rule.

The build writes no Java per bubble: every bubble element and the built-in bubble (`default`; a bubble element with
that id replaces it) become an entry of `assets/<modid>/bubbles.json` (`styles`), with their images copied to
`textures/bubble/<id>_background.png` and `<id>_icon.png`. Procedure blocks, all server side: `bubble_show` (field
`bubble` = bubble element id, "" the default; inputs `entity`, `caption`, `duration`: below 0 the bubble's own),
`player_bubble_clear` (`entity`), `player_bubble_icon` (`entity`; the icon id, or the bubble id for a bubble element,
"" none), and the older icon blocks `player_bubble_show` (`entity`, `icon`, `duration`, 0 or less = until cleared) and
`player_bubble_show_text` (plus `text`), which show the default bubble with `textures/bubbles/<icon>.png` as its icon
(file name = icon id, `[a-z0-9_]`; copied to the mod as it is, animated ones listed in `bubbles.json` `icons`).

<Mod>Bubbles reads `bubbles.json` from the mod jar on both sides, keeps one bubble per player (bubble, icon, caption) and
drops it when its time runs out, it is cleared, the player logs out or dies; each dimension's clients get the bubbles
of its players when they change and once a second. <Mod>BubbleRender draws any bubble from that data on all five
engines: a camera-facing background (one quad or nine), icon and caption, the bubble's bottom 0.47 blocks over the
player's height when the name tag shows, else 0.05 (Q217), plus `offset`; hidden while the player sneaks or is
invisible; show and hide animations by client game time. Hooks: forge-1.16.5 RenderNameplateEvent, NeoForge
RenderLivingEvent.Post, Fabric a client mixin at the end of LivingEntityRenderer.render (1.21.5) / submit (26.3).

Seatable blocks (Q225, `src/generator/seats.ts`, guide: [Seatable blocks](guide/en/06-seats.md)): the block's Seat page.
`seatable` turns it on; `seats` lists the seat points, `x`, `y`, `z` in block pixels from the north-west bottom corner
(16 = one block) for the block facing north (its model unturned) and `yaw` in degrees from the block's front (0 looks out
of the north face, 90 east), and `pose`: `sit`, or `lie` (the player lies on its back, head along the yaw, the middle of
the body on the point: feet `LIE_HALF` 0.85 blocks behind it, `LIE_LIFT` 0.125 above the surface; a pose only, no bed,
sleep or night skipping); a block with a `facing` property turns its seats with it, as its model and boxes. Points
may lie outside 0..16 so a block spanning several cells (Q226) can seat players in its other cells. `seatHeightMode`
`auto` sits each seat on the top of the block's boxes under it (`boundingBoxes` of a plain block, 8 for slabs and
stairs, 16 otherwise), `manual` uses its `y`. `seatEmptyHand` (default on) leaves clicks with an item in hand to the
item; `seatDismount` is where the player stands up: `top` of the block, `front` (the block in front of the seat on the
block's floor, `top` when blocked) or `back` (where they stood). Shared rules: `src/elements/seats.ts` (generator and
editor preview). The editor's preview draws the block with a sitting player figure on every seat; a click on a top
surface adds a seat, dragging moves it, its arrow (or R) turns it, Delete removes it.

The build writes no Java per block: every seatable block becomes an entry of `data/<modid>/seats.json` (seats in blocks
`[x, y, z, yaw, lying 1/0]`, `emptyHand`, `dismount`, and `cells` for a multi-block). `<Mod>Seats` (package `seat`) reads it from the mod jar and listens to right
clicks on blocks (forge-1.16.5 and NeoForge PlayerInteractEvent.RightClickBlock, Fabric UseBlockCallback): with the main
hand, not sneaking and not riding, the player sits on the free seat nearest the click; a taken seat refuses, and so does one whose room overlaps a rider
that lies or would lie (a lying body takes `LIE_REACH` 0.75 blocks either way along its yaw, any rider `SEAT_ROOM` 0.3
across), so a sofa's lying spot and the sitting spots under it are not used at once. The seat is
`<Mod>Seats.Seat` (entity `<modid>:mcedge_seat`, invisible, never saved, no renderer output) at the seat surface; the
player's feet are 0.6 blocks below it (`SIT_DROP`) and it faces the seat's yaw. Sneaking stands up (vanilla); the seat
removes itself when nobody sits on it or the block is broken or replaced. Procedure blocks: `entity_sit_on_block`
(`entity`, `x`, `y`, `z`; a seat block's free seat nearest the entity, any other block on the top of its shape),
`entity_is_sitting` (`entity`), `entity_stand_up` (`entity`). There is no sit/stand trigger yet. A lying seat
(synced to clients) places its rider itself (`positionRider`) and, on each client, gives it the sleeping pose with body
and head along the seat after the rider's own tick picked a pose; Forge and NeoForge keep its legs straight through
`shouldRiderSit`, Fabric through a client mixin (`SeatLyingMixin` on `HumanoidMobRenderer.extractHumanoidRenderState`).

Radial menus (Q227, `src/generator/radial.ts`, guide: [Radial menus and runtime images](guide/en/07-radial-menus.md)): a
`radial_menu` element, independent of any one use. Shared layout rules (slice angles, the slice under the mouse, the
slice shape, colours) are `src/elements/radialLayout.ts`, used by the generator and the editor's preview.
Menu fields: `openKey` (key name, `NONE` = procedures only), `openMode` (`hold`: releasing the key chooses; `toggle`),
`keyName`; `size`, `hole` (percent of the radius), `gap` (pixels between slices), `sliceColor` / `hoverColor` /
`disabledColor` at `sliceOpacity`, optional `sliceImage` / `hoverImage` / `disabledImage` (`sliceImageSize`);
`background` (`backgroundMode` `plain` or `nine_slice` with `sliceBorder`, `backgroundPadding`); `title`, `showLabel`,
`showDescription`, `centerIcon`, `textColor`, the opening transition (`appear`, `appearTicks`, `appearEasing`: the
show / hide timing model of the bubble, `src/elements/transitions.ts`; the wheel closes at once, so it has no
disappear), and animated slice icons play their playback mode (Q229). `tabs` (1-9):
`id`, `label`, `source` `list` with `slices` (at most 12: `id`, `label`, `description`, `iconKind` `texture` / `item` /
`none` with `icon` or `item`, `action`, `condition` (a logic procedure) and `conditionMode` `hidden` / `disabled`), or
`source` `folder` with `folder` and `pageSize` (2-12) and one action for all its files. Actions: `none`, `command`
(`command`, run as the player with their own permissions; `{id}` = the slice id), `procedure` (dependencies `entity`,
`world`, `x`, `y`, `z`, `menu`, `tab`, `slice`), `menu`, `gui`, `bubble` (`bubble`, `caption`, `duration`),
`image_bubble` (`image` = `folder/name`, or the chosen file of a folder tab).

The build writes no Java per menu: menus become `assets/<modid>/radial_menus.json` and one white slice image per shape
(`textures/radial/sector_<hole>_<gap>_<n>.png`, turned and tinted per slice). `RadialMenus` (server) opens a menu with the
states of its slices for that player (procedure overrides, else the condition), checks a chosen slice again (at most one
choice every 4 ticks), runs its action and calls the `radial_slice_chosen` global trigger; `RadialMenusClient` registers
the keys and asks the server to open; `RadialMenuScreen` draws every menu (tabs by mouse wheel, arrows or number keys,
pages for big folders). `RuntimeImages` loads `config/<modid>/<folder>/` (PNG, GIF decoded into a strip of square
frames; names `[a-z0-9_]{1,32}`, regular files only, at most 64 files of 1 MiB, 1024 pixels a side, 32 frames) when the
server starts and on `/<modid> reload` (permission 2), and sends them to players on join and reload; clients register
them as textures and as bubble icons `img:<folder>/<name>`. Procedure blocks: `radial_open`, `radial_close`,
`radial_set_slice` (state `default`, `shown`, `hidden`, `disabled`), `runtime_image_bubble` (`image`, `caption`,
`duration`); global trigger `radial_slice_chosen`.

Multi-blocks (Q226, `src/generator/multiBlock.ts`, shared rules `src/elements/multiBlock.ts`): `multiBlock` on the
Bounding boxes page lets a plain block (no base; no facing or `rotationMode` 1/3 without pitch) span every cell its added
boxes cover: boxes may go below 0 and above 16 (a 2x3 sofa is x -16..16, z -16..32). Cells are whole blocks from the
placed block (the origin), for the block facing north, origin first; at most 64. The block gets a `part` state property
(0 = the origin, which draws the model; the others use `<id>_part`, an empty model with the block's particle texture)
and extends the generated `<Mod>MultiBlock` (package `block`), which holds the rules for every such block: the origin
fits only when every other cell is inside the world and replaceable (`canSurvive`, which block items check), the origin
places its parts when it is placed (`onPlace`: by a player, a command or a procedure; flags 2|16 so the half-placed
block does not see itself broken), a part whose block is no longer whole (any cell missing, turned or another part)
turns to air (`updateShape`), so breaking any part removes all of them; only part 0 has loot (`block_state_property`
`part=0`), and the origin dropping when its neighbour part goes gives one drop whichever part was broken (as vanilla doors);
in creative, breaking another part removes the origin first without drops. Pistons cannot move it (push reaction
`BLOCK`). Each part's outline and collision is the block's boxes cut to its cell, turned with the facing; cells turn the
same way (a quarter clockwise turns `[x, z]` into `[-z, x]`). Seats (Q225) keep one list for the whole block in the
origin's pixels; seats.json carries the cells, so a click on any part seats on the whole block. Waterlogging and
gravity are off for a multi-block (warned). The editor's preview on the Bounding boxes page outlines the cells over the
model, the Seat page's preview shows them too. JSON models with element rotations newer versions allow (any angle,
`{"x", "y", "z"}`) are written for 1.16.5 and 1.21.5 with whole quarter turns about y baked in and the rest on one axis
snapped to 22.5 degree steps (warned); 26.x keeps them.

Slot events (Q203): `onSlotChanged` runs on the server once each time the stack in one of the GUI's slots changes
while the screen is open, with the usual GUI dependencies plus `slot` (the slot id; `dep_number` "slot"); a session
GUI's procedure reads its session with `gui_session_id`. The menu compares its slots with the stacks last seen in the
backing container on every broadcast (each tick and after each click), so clicks, shift clicks, procedure writes and
hoppers or other automation on the block all count, and a change that comes back to the same stack before the next
broadcast does not. The menus of one container share what they have seen, so a change runs the procedure once however
many players have the GUI open. Slots the procedure itself changes count as seen and do not run it again. There is no
per-slot field: branch on `slot`.

### Creative tab order

A `creative_tab` element's `order` (field type `tab_order`, `src/elements/tabOrder.ts`) lists the mod elements in the
tab in order: `{ "kind": "element", "type": "item", "id": "ruby" }`, titled sections `{ "kind": "section", "title": "Ores" }`,
spacers `{ "kind": "spacer", "slots": 2 }` (no `slots`: to the end of the row) and section ends `{ "kind": "end" }`
(KUYRUK 172): a section holds the rows after it up to the next section or its end; rows after an end stand outside
sections (on 1.16.5 they start a new row), and an end that closes no section is dropped. The members are the elements whose
`creativeTabs` name the tab; the order only arranges them, so one that leaves the tab drops out and a new one comes last.
Every engine writes the order (1.16.5 `fillItemList`, 1.20+ `displayItems`). A section starts a new row and a spacer
leaves empty slots on 1.16.5 only, since newer tabs cannot show empty slots. MCP: `read_tab_order`, `write_tab_order`.

### Optional mod integrations

An integration is a data file, `config/integrations/<id>.json`: the other mod per engine (`modId`, `version`, Maven
`repositories`, `gradle` lines as written) and the fields it adds, a group per element type, shown on an Integrations
page. A project turns it on in mod settings (`mod.integrations: [{ "id", "required" }]`); the generator then adds the
other mod to `build.gradle` and to the metadata as an optional or required dependency, and the integration's code
(`src/generator/integrations/`). The fields stay hidden while it is off. MCP: `list_integrations`, `set_integration`.

`recipe_viewer` (JEI on Forge and NeoForge, REI on Fabric): a block with `rvCategory` gets a recipe category titled
`rvTitle` (default: its name), the block and `rvCatalysts` as crafting stations, and `rvRecipes` (`inputs` and
`outputs` as `{ item, count }`, `time` in ticks, `energy` in FE) as its recipes.

### Living entities

`mobModelName` is a built-in model (Biped, Chicken, Cod, Cow, Creeper, Ghast, Ocelot, Pig, Piglin, Salmon, Silverfish,
Slime, Spider, Villager, Witch) or a project model: `models/<name>.java` (a Blockbench "Modded Entity" Java export,
Mojang or MCP names, any version) or `models/<name>.bbmodel`. MCEdge reads the model's parts and writes the Java model
for each engine itself (`src/generator/mob/models.ts`), so one file works on every version. Render layers (`modelLayers`)
draw the entity's model or another project model with their own texture. Animations (`animations.animation`) name an
animation of the model by its full name (`RubyBeastAnimation.WALK`, `animation.beast.walk`) or its last part
(`walk`); Blockbench animation exports in any `models/*.java` file count. MCEdge plays them with its own keyframe
sampler (`<Mod>Animator`), also on 1.16.5. AI goals (`aixml`) are the `ai_*` blocks (category "ai") under the start
block, highest priority first; an empty program keeps the default goals. MCP: `entity_models`, `write_ai_goals`.

### Project block and item models

A `model` field (block `customModelName` with model type JSON or OBJ, item and tool `model`, shield `blockingModel`,
plant `model`, armor `*ItemCustomModelName` with item model type JSON or OBJ) names a built-in shape or a project model:
`models/<name>.json` (a Java block/item model; a `models/<name>.bbmodel` not imported yet is converted on build) or
`models/<name>.obj` with its `.mtl`. It is written once to `assets/<modid>/models/custom/<name>.json` and the element's
own models use it as their parent, so blockstate rotations, display transforms and the item model keep working; the
block's bounding boxes and transparency fields apply as for built-in shapes (custom shapes never hide their
neighbours' faces). Textures the model names are copied: project files (`models/`, `textures/`, by path or file name)
go to `textures/block/...`, vanilla references stay. OBJ models use NeoForge's `neoforge:obj` and Forge 1.16.5's
`forge:obj` loader; Fabric has none, so MCEdge generates `<Mod>ObjModels`, a model loading plugin that bakes the same
.obj file into quads (materials become texture slots `m0`, `m1`, ... named by the .mtl's `map_Kd`). Code:
`src/generator/models.ts`.

Java models (`models/<name>.java`, Blockbench "Modded Entity") on blocks, items and tools (`src/generator/javaModels.ts`):
a block with model type 4 gets a block entity and a block entity renderer drawing the model with the block texture,
turned to its facing, with `animations` (animation name, speed, play condition) played by `<Mod>Animator`; its block
item and Java model items and tools (also a shield's blocking model) are drawn by an item renderer with their texture:
an ItemStackTileEntityRenderer on 1.16.5, a `minecraft:special` item model renderer on 1.21.5 and 26.3 (registered
through NeoForge's event, on Fabric through a client mixin).

Worn armor models (`helmetModelName`, ...) are `models/<name>.java` or `.bbmodel` entity models: the parts named by
`helmetModelPart`, `bodyModelPart`, `armsModelPartL/R`, `leggingsModelPartL/R`, `bootsModelPartL/R` are attached to the
wearer's head, body, arms and legs (taking their pose) and drawn with `*ModelTexture` (else the armor texture),
translucent when `*Translucency` is set. 1.16.5 returns them from the item's `getArmorModel`; NeoForge draws them from
a render layer on humanoid renderers, Fabric from an `ArmorRenderer` (`src/generator/wornModels.ts`). MCP:
`list_resources` gives each model's kind and the element fields using it.

### Block and item states

Block `customProperties` become block state properties (logic: boolean; integer and number: integer, whole numbers
only; text: an enum of the allowed values) with their starting value. Each `states` row names property values (custom
or the block's own `facing`, `axis`, `face`, `waterlogged`) and gives the block another model (built-in shape,
JSON/OBJ), textures and, with `hasCustomBoundingBox`, boxes while they all match; the first matching row wins. The
blockstate file lists every combination of the properties the rows name (variants); `multipartModel` draws each
matching row's model over the block's own instead. Item `customProperties` are numbers computed by procedures; a
`states` row switches the item to its model and texture while every listed property (custom, or `damaged`, `damage`,
`lefthanded`, `cooldown`) is at least the listed value, first row first: model overrides on 1.16.5, nested
`range_dispatch`/`condition`/`select` item models on 1.21.5 and 26.3, whose custom properties are registered range
select properties (NeoForge event, Fabric client mixin). Code: `src/generator/states.ts`.

### showIf

A field is shown only while its condition holds. A leaf compares one field: `{ "key": "hasGravity", "equals": true }`,
with exactly one of `equals`, `notEquals`, `in`, `notIn` (arrays of values), `gt`, `gte`, `lt`, `lte` (numbers).
`{ "all": [...] }` and `{ "any": [...] }` combine conditions and nest. Inside a `list` row, keys refer to the
row's own fields first, then to the element. A field whose condition reads a hidden field is hidden too, so
chains (portal, then igniter, then igniter texture) collapse together. Hidden fields keep their values but are not
validated, so `required` only applies while a field is shown.

Defaults must be valid values so a new element works without edits. Labels and help text are written
for MCEdge; MCreator's own UI text is not copied.

## Generating a type

An engine generates a type when two things exist:

1. **A context module** `src/generator/types/<typeId>.ts` default-exporting a `TypeModule`
   (`src/generator/typeModule.ts`). `element(element, env)` returns the template context of one element:
   Java expressions, enum constants and JSON fragments, computed per engine from `env.mc` ("1.16.5", "1.21.5",
   "26.3") and `env.loader`. It can also contribute lang entries (`lang`), texture copies (`textures`), tag
   memberships (`tags`, merged into `data/<ns>/tags/...` files) and creative tab members (`tabItems`).
   `global(contexts, env)` adds root context built from all elements of the type. The generator discovers
   modules by file name; shared helpers live in `src/generator/java.ts`.
2. **Templates and coverage** in a layer: a path segment `[<typeId>]` repeats a file per element of that type
   (`[recipe.dataPath]` names it after a context value, `[block+hasLoot]` / `[block!hasLoot]` filters on one),
   and the layer's `layer.json` `generates` lists the fields that really change the built mod. The editor badges
   every field not listed for the selected engine.

Code-registered elements (mob effects, potions, particle types, attributes, ...) get a `<Mod><Things>` class from
`registryClass` in `src/generator/registries.ts` (DeferredRegister on Forge/NeoForge, registration on class load on
Fabric), returned by the module's `runtime`. Project files copied as they are (structure templates) go in `copies`.
Parts of an element an engine cannot generate are reported through `procedureBuild(env).warnings`.

Element contexts are available to templates as the type's folder name (`items`, `blocks`, `loot_tables`, ...);
each element also gets `constant` (`RUBY`) and `className` (`RubyItem`). Java fields derived from an element (a block's item, a
fluid's bucket, a mob's spawn egg) are named with `derivedConstant` (`RUBY_LAMP_Item`): the CamelCase part keeps them apart
from element constants, which are upper case only.

## Procedures

A procedure element stores its program in the `program` field as procedure IR (`src/procedures/model.ts`):

```json
{ "format": 1,
  "variables": [{ "name": "count", "type": "number" }],
  "stacks": [{ "x": 40, "y": 40, "blocks": [
    { "block": "start" },
    { "block": "log", "inputs": { "text": "hello" } } ] }] }
```

A node is `{ block, fields?, inputs?, collapsed?, disabled? }`. An input holds a value node, a list of statement
nodes (statement inputs) or a literal (number, text, logic), which the editor shows as an editable shadow. The
stack that starts with `start` is the procedure body; other stacks are kept but not generated. Local variables live
in the IR; global variables come from the project's `variables.json` with session, world, map or player scope.
Dependencies (world, x, y, z, entity, ...) are not stored: they are inferred from the blocks used and checked
against what the trigger or calling field provides, and missing ones are warned on the block.

- **Blocks** are defined in `src/procedures/blocks/` (`BlockDef`: category, side, output type, inputs, fields,
  dependencies and a Java code table keyed by generation and loader). Labels, tooltips and categories are in
  `config/procedure-blocks/<lang>.json`. A block without code for an engine is not generated there: the editor
  marks it and the build lists it under "not generated".
- **Sides.** Each block runs on the server, the client or both. When a statement of the other side follows,
  the compiler cuts that run into a segment and generates a payload carrying the dependencies and locals it
  reads, sent server-to-client (to the players in the dimension, or one player) or client-to-server, with
  registration for every loader and version.
- **Triggers.** A procedure with `globalTrigger` is registered on that game event in `<Mod>Procedures.init`
  (`src/procedures/triggers.ts`). Element fields of kind `procedure` (item, tool, block events) call the
  procedure from the generated element class with the dependencies that event provides.
- **Blockly fields** in other element types (`blockly`) store the same IR and are edited with the same canvas.
  A command's `argsxml` program is compiled as procedure `command:<id>` (`<Id>CommandProgram`) and runs when the
  command does, with the typed text as the `command` dependency (read by the command word / number blocks).
- **MCP:** `procedure_blocks`, `procedure_triggers`, `read_procedure` and `write_procedure` read and write
  procedures through the IR.
