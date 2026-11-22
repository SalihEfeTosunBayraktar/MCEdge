/**
 * Q276: one GUI with every kind of text (labels plain, scaled, centred, right aligned, on a background, white; a
 * button, a text field, a checkbox), the same layout for the 26.3 game screenshot and the GUI editor screenshot.
 */
export const TEXT_GUI = {
  type: 0, width: 176, height: 166, renderBgLayer: true,
  components: [
    { kind: "label", name: "plain", x: 8, y: 6, text: "Plain label 123", color: "#404040" },
    { kind: "label", name: "scaled", x: 8, y: 20, text: "Scaled x2", color: "#404040", textScale: 2 },
    { kind: "label", name: "centred", x: 88, y: 44, text: "Centred text", color: "#404040", align: "center" },
    { kind: "label", name: "right", x: 168, y: 56, text: "Right edge", color: "#404040", align: "right" },
    { kind: "label", name: "boxed", x: 8, y: 70, text: "On a background", color: "#FFFFFF", background: "#000000", backgroundOpacity: 50 },
    { kind: "label", name: "white", x: 8, y: 84, text: "White gyjpq WMW", color: "#FFFFFF" },
    { kind: "button", name: "btn", x: 8, y: 100, width: 80, height: 20, text: "Button text" },
    { kind: "text_field", name: "field", x: 92, y: 100, width: 76, height: 20, text: "Hint" },
    { kind: "checkbox", name: "check", x: 8, y: 126, text: "Check" },
    { kind: "label", name: "small", x: 100, y: 130, text: "Half", color: "#404040", textScale: 0.5 },
  ],
};
