/** No SW in unit tests; update.store tests explicitly drive the registration callbacks. */
export function registerSW(_options: unknown) { return async (_reload?: boolean) => {}; }
