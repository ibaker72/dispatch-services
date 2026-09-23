"use client";

import * as React from "react";

/** Hidden input carrying the browser's UTC offset so datetime-local values can be stored in UTC. */
export function TimezoneOffsetInput({ name = "timezone_offset" }: { name?: string }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.value = String(new Date().getTimezoneOffset());
  }, []);
  return <input ref={ref} type="hidden" name={name} defaultValue="0" />;
}
