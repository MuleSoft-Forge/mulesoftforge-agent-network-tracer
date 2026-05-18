import { useRef, type KeyboardEvent } from "react";

/** True while CJK IME is converting input (Enter confirms conversion, not submit). */
export function isImeComposing(e: KeyboardEvent<HTMLElement>, composing: boolean): boolean {
  return composing || e.nativeEvent.isComposing || e.key === "Process";
}

/** Track IME composition for Enter-to-submit handlers (JP/CN/KR input). */
export function useImeComposition() {
  const composingRef = useRef(false);

  return {
    compositionProps: {
      onCompositionStart: () => {
        composingRef.current = true;
      },
      onCompositionEnd: () => {
        composingRef.current = false;
      },
    },
    isComposing: (e: KeyboardEvent<HTMLElement>) =>
      isImeComposing(e, composingRef.current),
  };
}
