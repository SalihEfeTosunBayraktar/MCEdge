import { itemExpr, str } from "../java.ts";
import type { TypeModule } from "../typeModule.ts";

export default {
  element: (tab, env) => {
    const search = tab.showSearch === true && env.loader !== "fabric";
    if (env.mc === "1.16.5") {
      // 1.16.5 tabs are ItemGroup subclasses: the search bar is an override plus the search background.
      const init = [search ? "setBackgroundSuffix(\"item_search.png\");" : "", tab.hideTitle === true ? "hideTitle();" : ""].filter(Boolean);
      return {
        iconRef: itemExpr(env, str(tab.icon)),
        tabExtras: (init.length ? `\n        {\n            ${init.join("\n            ")}\n        }\n` : "")
          + (search ? "\n        @Override\n        public boolean hasSearchBar() {\n            return true;\n        }\n" : ""),
      };
    }
    // Fabric's tab builder is vanilla's, which has no search bar.
    const chain = [search ? ".withSearchBar()" : "", tab.hideTitle === true ? ".hideTitle()" : ""].join("");
    return { iconRef: itemExpr(env, str(tab.icon)), tabExtras: chain };
  },
} satisfies TypeModule;
