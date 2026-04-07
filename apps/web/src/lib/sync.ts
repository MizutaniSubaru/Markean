export function startBackgroundSync(runOnce: () => Promise<void>) {
  let stopped = false;
  let timeoutId: number | undefined;

  const scheduleNextTick = () => {
    if (stopped) {
      return;
    }

    timeoutId = window.setTimeout(() => {
      if (stopped) {
        return;
      }

      void runOnce().finally(() => {
        scheduleNextTick();
      });
    }, 15_000);
  };

  const handleOnline = () => {
    void runOnce();
  };

  window.addEventListener("online", handleOnline);
  void runOnce().finally(() => {
    scheduleNextTick();
  });

  return () => {
    stopped = true;
    window.removeEventListener("online", handleOnline);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  };
}
