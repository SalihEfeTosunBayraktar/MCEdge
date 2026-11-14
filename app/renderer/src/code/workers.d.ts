/** Vite's "?worker" imports: a Worker constructor for the module. */
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
