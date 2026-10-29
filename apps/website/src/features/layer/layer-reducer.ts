export function layerReducer(
  _focus: string | null,
  action: { readonly type: "focus"; readonly id: string | null }
): string | null {
  return action.id;
}
