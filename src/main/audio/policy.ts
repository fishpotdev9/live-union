import type { AudioIntent } from '../../shared/app-contracts.ts';
import type { RoomId } from '../../shared/contracts.ts';

export interface AudioContents {
  isDestroyed():boolean;
  setAudioMuted(muted:boolean):void;
}
interface Entry {contents:AudioContents;allowed:boolean;ready:boolean}

/** The only authority for software audio intent; page audio activity is separate. */
export class AudioPolicy {
  private entries=new Map<RoomId,Entry>();
  private revision=0;

  add(id:RoomId,contents:AudioContents,savedAllowed=false):void {
    // Never register an unmuted instance, even when restoring an audible room.
    contents.setAudioMuted(true);
    this.entries.set(id,{contents,allowed:savedAllowed,ready:false});
    this.revision++;
  }
  remove(id:RoomId):void {
    const entry=this.entries.get(id);
    this.entries.delete(id);
    this.revision++;
    if(entry)this.mute(entry,true);
  }
  loading(id:RoomId):void {
    const entry=this.entries.get(id);
    if(!entry)return;
    entry.ready=false;
    this.revision++;
    this.mute(entry,true);
  }
  ready(id:RoomId):void {
    const entry=this.entries.get(id);
    if(!entry)return;
    entry.ready=true;
    this.enforce(++this.revision);
  }
  apply(intent:AudioIntent):ReadonlyMap<RoomId,boolean> {
    const revision=++this.revision;
    if(intent.kind==='muteAll')for(const entry of this.entries.values())entry.allowed=false;
    else if(intent.kind==='solo') {
      // A missing target still leaves everything muted; it never picks a fallback.
      for(const [id,entry] of this.entries)entry.allowed=id===intent.roomId;
    } else {
      const entry=this.entries.get(intent.roomId);
      if(entry)entry.allowed=intent.allowed;
    }
    this.enforce(revision);
    return this.snapshot();
  }
  snapshot():ReadonlyMap<RoomId,boolean> {
    return new Map([...this.entries].map(([id,entry])=>[id,entry.allowed]));
  }
  private mute(entry:Entry,muted:boolean):boolean {
    try {
      if(entry.contents.isDestroyed())return true;
      entry.contents.setAudioMuted(muted);
      return true;
    } catch {return false;}
  }
  private enforce(revision:number):void {
    let safelyMuted=true;
    for(const entry of this.entries.values()) {
      if(revision!==this.revision)return;
      if(!entry.allowed||!entry.ready)safelyMuted=this.mute(entry,true)&&safelyMuted;
    }
    // If another room could not be silenced, do not introduce a new sound source.
    if(!safelyMuted)return;
    for(const [id,entry] of this.entries) {
      if(revision!==this.revision)return;
      if(this.entries.get(id)===entry&&entry.allowed&&entry.ready)this.mute(entry,false);
    }
  }
}
