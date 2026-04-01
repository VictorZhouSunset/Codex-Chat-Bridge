export function observeRelayCompletion(result, onError = () => {}) {
  if (!result?.completion || typeof result.completion.catch !== "function") {
    return;
  }

  void result.completion.catch((error) => {
    onError(error);
  });
}
