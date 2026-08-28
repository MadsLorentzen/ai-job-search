export function createAsyncMessageQueue({ capacity = 8 } = {}) {
  const buffer = [];
  const waiters = [];
  let closed = false;
  let failure = null;

  function settleWaiter(result, error) {
    const waiter = waiters.shift();
    if (!waiter) return;
    if (error) waiter.reject(error);
    else waiter.resolve(result);
  }

  return {
    get size() {
      return buffer.length;
    },
    push(message) {
      if (closed || failure) return { accepted: false, reason: "closed" };
      if (waiters.length) {
        settleWaiter({ value: message, done: false });
        return { accepted: true };
      }
      if (buffer.length >= capacity) return { accepted: false, reason: "full" };
      buffer.push(message);
      return { accepted: true };
    },
    close() {
      closed = true;
      while (waiters.length) settleWaiter({ value: undefined, done: true });
    },
    fail(error) {
      failure = error;
      closed = true;
      while (waiters.length) settleWaiter(undefined, error);
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (buffer.length) return Promise.resolve({ value: buffer.shift(), done: false });
          if (failure) return Promise.reject(failure);
          if (closed) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
      };
    },
  };
}
