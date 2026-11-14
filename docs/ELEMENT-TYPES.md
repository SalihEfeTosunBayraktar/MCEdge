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
