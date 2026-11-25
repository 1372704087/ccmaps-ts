// Browser shim for the small part of node:os the shared render engine touches.
export function totalmem(): number {
  return 0;
}

export function availableParallelism(): number {
  return 1;
}
