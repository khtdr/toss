import { DEFAULT_SEND_SETTINGS } from 'expo-toss';
import { DATA_OVERHEAD } from 'toss-core';
import { maxFrameBytes } from 'toss-qr';
import type { Link } from './estimate';

/**
 * Both phones hold the file in memory, and this is about 4.5 hours of holding
 * them still. It also stops a hostile sender claiming an enormous file.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export const SEND_SETTINGS = DEFAULT_SEND_SETTINGS;

export const LINK: Link = {
  fps: SEND_SETTINGS.fps,
  blockBytes: maxFrameBytes(SEND_SETTINGS) - DATA_OVERHEAD,
};
