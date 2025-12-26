export type KeyboardEventType = 'press' | 'repeat' | 'release';

export type KeyboardEvent = {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  sequence?: string;
  baseCode?: number;
  eventType?: KeyboardEventType;
  repeated?: boolean;
};
