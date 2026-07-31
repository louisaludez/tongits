// @ts-ignore
import { zzfx } from 'zzfx';

export const playSound = {
  click: () => {
    try {
      zzfx(...[,,400,,.04,,1,1.5,,,,,,.1]);
    } catch (e) {}
  },
  cardDraw: () => {
    try {
      zzfx(...[,,800,.01,.05,.05,1,.5,,,,,,.1]); 
    } catch (e) {}
  },
  cardDrop: () => {
    try {
      zzfx(...[1,,250,.01,.05,.05,1,1.5,,,,,,.1]);
    } catch (e) {}
  },
  fight: () => {
    try {
      zzfx(...[1.5,,600,.05,.1,.3,1,1.5,,,.1,.1,.1,.1,.1]);
    } catch (e) {}
  },
  win: () => {
    try {
      zzfx(...[2,,400,.1,.3,.5,1,1.5,,,,,,.1]);
      setTimeout(() => zzfx(...[2,,600,.1,.3,.5,1,1.5,,,,,,.1]), 100);
      setTimeout(() => zzfx(...[2,,800,.1,.5,.8,1,1.5,,,,,,.1]), 250);
    } catch (e) {}
  },
  error: () => {
    try {
      zzfx(...[2,,150,.05,.1,.1,2,1.5,,,,,,.1]);
    } catch (e) {}
  }
};
