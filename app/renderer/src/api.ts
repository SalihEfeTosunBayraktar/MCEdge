import type { McedgeApi } from "../../shared/api.ts";

declare global {
  interface Window {
    mcedge: McedgeApi;
  }
}

export const api: McedgeApi = window.mcedge;
