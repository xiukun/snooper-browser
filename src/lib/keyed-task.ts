/** Per-key async coordination for capture startup. */
export type KeyedTaskMode = 'share' | 'queue'

export function runKeyedTask<K, T>(
  tasks: Map<K, Promise<unknown>>,
  key: K,
  mode: KeyedTaskMode,
  task: () => Promise<T>,
): Promise<T> {
  const previous = tasks.get(key)
  if (mode === 'share' && previous) return previous as Promise<T>

  const run = mode === 'queue' && previous
    ? previous.catch(() => undefined).then(task)
    : task()

  tasks.set(key, run)
  const settle = () => {
    if (tasks.get(key) === run) tasks.delete(key)
  }
  run.then(settle, settle)
  return run
}
