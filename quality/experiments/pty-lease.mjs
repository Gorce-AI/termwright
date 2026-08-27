export function createPtyLeasePool(capacity) {
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new Error('invalid PTY lease capacity');
  let available = capacity;
  const waiters = [];

  return {
    request() {
      let state = 'pending';
      let rejectRequest;
      let releaseLease;
      let resolveRequest;
      const waiter = {
        grant() {
          if (state !== 'pending') return;
          state = 'granted';
          releaseLease = releaseOnce(release);
          resolveRequest({
            claim() {
              if (state === 'cancelled')
                throw new Error('PTY lease grant was cancelled before claim');
              if (state !== 'granted') throw new Error(`PTY lease cannot be claimed from ${state}`);
              state = 'claimed';
              return releaseLease;
            },
          });
        },
      };
      const promise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      const request = {
        promise,
        cancel() {
          if (state === 'pending') {
            state = 'cancelled';
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            rejectRequest(new Error('PTY lease request outlived its test'));
          } else if (state === 'granted') {
            state = 'cancelled';
            releaseLease();
          }
        },
      };

      if (available > 0) {
        available -= 1;
        waiter.grant();
      } else {
        waiters.push(waiter);
      }
      return request;
    },
  };

  function release() {
    const waiter = waiters.shift();
    if (waiter === undefined) available += 1;
    else waiter.grant();
  }
}

function releaseOnce(release) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}
