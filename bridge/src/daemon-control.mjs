export async function isBridgeHealthy({ controlPort, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${controlPort}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchBridgeStatus({ controlPort, fetchImpl = fetch }) {
  const response = await fetchImpl(`http://127.0.0.1:${controlPort}/status`);
  if (!response.ok) {
    throw new Error(`Failed to read Telegram bridge status on port ${controlPort}.`);
  }

  return response.json();
}

export async function ensureBridgeRunning({
  controlPort,
  fetchImpl = fetch,
  startFn,
  sleepFn = delay,
  maxAttempts = 10,
}) {
  if (await isBridgeHealthy({ controlPort, fetchImpl })) {
    return;
  }

  await startFn();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isBridgeHealthy({ controlPort, fetchImpl })) {
      return;
    }
    await sleepFn(300);
  }

  throw new Error(`Telegram bridge did not become healthy on port ${controlPort}.`);
}

export async function stopBridge({ controlPort, source, fetchImpl = fetch }) {
  const init = {
    method: "POST",
  };

  if (source) {
    init.headers = {
      "content-type": "application/json",
    };
    init.body = JSON.stringify({ source });
  }

  const response = await fetchImpl(`http://127.0.0.1:${controlPort}/shutdown`, init);

  if (!response.ok) {
    throw new Error(`Failed to stop Telegram bridge on port ${controlPort}.`);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
