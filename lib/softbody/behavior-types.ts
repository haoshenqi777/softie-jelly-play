import type { SocialBeat } from './social-response.ts';
import type { CandyAttention, CandyObservation } from './candy-interest.ts';
export type V3 = [number, number, number];

export type BehaviorPhase =
  | 'idle'
  | 'held'
  | 'airborne'
  | 'landing'
  | 'righting'
  | 'orient'
  | 'returning'
  | 'arrived'
  | 'noticing'
  | 'seeking'
  | 'inspecting'
  | 'collecting'
  | 'absorbing';

export type CharacterObservation = {
  time: number;
  center: V3;
  velocity: V3;
  up: V3;
  forward: V3;
  grounded: boolean;
  held: boolean;
  stable: boolean;
  width: number;
  height: number;
  impactSpeed: number;
  rendezvous: V3;
  viewerDirection: V3;
  cameraMoving: boolean;
  candies?: readonly CandyObservation[];
  canAbsorb?: boolean;
  absorbing?: boolean;
  turning?: boolean;
  gravity?: number;
};

export type CharacterEvent =
  | { kind: 'grab' | 'cancel' | 'reset'; time: number }
  | {
      kind: 'release';
      time: number;
      velocity: V3;
      carriedDistance: number;
      valid: boolean;
    }
  | { kind: 'stroke'; time: number; seconds: number };

export type CharacterIntent = {
  phase: BehaviorPhase;
  candy: CandyAttention | null;
  destination: V3 | null;
  facing: V3;
  mood: number;
  social: SocialBeat;
  socialAge: number;
  comfort: number;
  joy: number;
  gait: 'scoot' | 'hop';
  desiredSpeed: number;
  body:
    | 'quiet'
    | 'recover'
    | 'puff'
    | 'travel'
    | 'brake'
    | 'complain'
    | 'curious'
    | 'shift'
    | 'stretch'
    | 'rest';
};
