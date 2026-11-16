/**
 * Whether the elements name a resource, as "<modid>:<name>" or "<name>" (sounds, models, structures). Pure, so the
 * delete check, the Resources folder dialogs and the MCP server agree on what is in use.
 */
export function elementsNaming(elements: unknown): (name: string) => boolean {
  const text = JSON.stringify(elements);
  return (name) => text.includes(`:${name}"`) || text.includes(`"${name}"`);
}
