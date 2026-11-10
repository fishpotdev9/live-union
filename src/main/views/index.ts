import { BrowserWindow, View, WebContentsView, session } from 'electron';
import type { RoomRuntimeManager, RuntimeOptions } from '../runtime-contracts.ts';
import { createSessionPolicy } from '../sessions/policy.ts';
import { createManager } from './manager.ts';

export function createRuntimeManager(options:RuntimeOptions):RoomRuntimeManager {
  const sessions=createSessionPolicy(options.window,{
    fromPartition:partition=>session.fromPartition(partition),
    createWindow:preferences=>new BrowserWindow(preferences),
  });
  return createManager(options,{
    createGroup:()=>new View(),
    createWebView:preferences=>new WebContentsView({webPreferences:preferences}),
    sessions,
  });
}
