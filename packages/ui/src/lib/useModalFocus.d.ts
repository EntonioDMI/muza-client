/** Focus model for a modal layer built outside `Dialog`: focus in, Tab trap,
 *  restore on close. Returns the handler to put on the layer root's onKeyDown. */
export declare function useModalFocus(
  open: boolean,
  panelRef: React.RefObject<HTMLElement | null>,
  mounted?: boolean,
): (e: React.KeyboardEvent) => void;
