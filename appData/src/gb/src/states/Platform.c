// clang-format off
#pragma bank 5
// clang-format on

#include "states/Platform.h"
#include "Actor.h"
#include "BankManager.h"
#include "Camera.h"
#include "Collision.h"
#include "Core_Main.h"
#include "DataManager.h"
#include "GameTime.h"
#include "Input.h"
#include "Math.h"
#include "ScriptRunner.h"
#include "Scroll.h"
#include "Sprite.h"
#include "Trigger.h"

#define MIN_WALK_VEL 0x130
#define WALK_ACC 0x98
#define RUN_ACC 0xe4
#define RELEASE_DEC 0xd0
#define SKID_DEC 0x1a0
#define MAX_WALK_VEL 0x1900
#define MAX_RUN_VEL 0x2900
#define SKID_TURN_VEL 0x900
#define JUMP_MOMENTUM 0x98
#define JUMP_VEL 0x4000
#define HOLD_GRAV 0x200
#define GRAV 0x700
#define MAX_FALL_VEL 0x4E20
#define PLATFORM_CAMERA_DEADZONE_X 4
#define PLATFORM_CAMERA_DEADZONE_Y 16

UBYTE grounded = FALSE;
UBYTE on_ladder = FALSE;
WORD pl_vel_x = 0;
WORD pl_vel_y = 0;
WORD pl_pos_x = 16512;
WORD pl_pos_y = 1024;

void Start_Platform() {
  UBYTE tile_x, tile_y;

  pl_pos_x = (player.pos.x + 4u) << 4;
  pl_pos_y = player.pos.y << 4;
  pl_vel_x = 0;
  pl_vel_y = 0;

  if (player.dir.x == 0) {
    player.dir.y = 0;
    player.dir.x = 1;
    player.rerender = TRUE;
  }

  tile_x = DIV_8(player.pos.x);
  tile_y = DIV_8(player.pos.y);

  grounded = FALSE;
  // If starting tile was a ladder start scene attached to it
  if (TileAt(tile_x, tile_y) & TILE_PROP_LADDER) {
    on_ladder = TRUE;
    player.dir.x = 0;
    player.dir.y = -1;
  }

  camera_offset.x = 0;
  camera_offset.y = 0;
  camera_deadzone.x = PLATFORM_CAMERA_DEADZONE_X;
  camera_deadzone.y = PLATFORM_CAMERA_DEADZONE_Y;

  game_time = 0;
}

void Update_Platform() {
  UBYTE tile_x, tile_y;
  UBYTE hit_actor = 0;
  UBYTE hit_trigger = 0;

  // Update scene pos from player pos (incase was moved by a script)
  pl_pos_x = ((player.pos.x + 4u) << 4) + (pl_pos_x & 0xF);
  pl_pos_y = ((player.pos.y) << 4) + (pl_pos_y & 0xF);

  tile_x = DIV_8(player.pos.x);
  tile_y = DIV_8(player.pos.y);

  // Move
  if (on_ladder) {
    player.dir.x = 0;
    player.dir.y = -1;
    pl_vel_x = 0;
    if (INPUT_UP) {
      pl_vel_y = -MAX_WALK_VEL;
    } else if (INPUT_DOWN) {
      pl_vel_y = MAX_WALK_VEL;
    } else {
      if (INPUT_LEFT) {
        on_ladder = FALSE;
        player.dir.x = -1;
        player.dir.y = 0;
        player.rerender = TRUE;
      } else if (INPUT_RIGHT) {
        on_ladder = FALSE;
        player.dir.x = 1;
        player.dir.y = 0;
        player.rerender = TRUE;
      }
      pl_vel_y = 0;
    }
  } else {
    player.dir.y = 0;

    if ((INPUT_UP || INPUT_DOWN) && ((TileAt(tile_x, tile_y) & TILE_PROP_LADDER))) {
      on_ladder = TRUE;
      pl_vel_x = 0;
      player.dir.x = 0;
      player.dir.y = -1;      
      player.rerender = TRUE;
    }
    if (INPUT_LEFT) {
      player.dir.x = -1;
      if (INPUT_A) {
        pl_vel_x -= RUN_ACC;
        pl_vel_x = CLAMP(pl_vel_x, -MAX_RUN_VEL, -MIN_WALK_VEL);
      } else {
        pl_vel_x -= WALK_ACC;
        pl_vel_x = CLAMP(pl_vel_x, -MAX_WALK_VEL, -MIN_WALK_VEL);
      }
    } else if (INPUT_RIGHT) {
      player.dir.x = 1;
      if (INPUT_A) {
        pl_vel_x += RUN_ACC;
        pl_vel_x = CLAMP(pl_vel_x, MIN_WALK_VEL, MAX_RUN_VEL);
      } else {
        pl_vel_x += WALK_ACC;
        pl_vel_x = CLAMP(pl_vel_x, MIN_WALK_VEL, MAX_WALK_VEL);
      }
    } else if (grounded) {
      if (pl_vel_x < 0) {
        pl_vel_x += RELEASE_DEC;
        if (pl_vel_x > 0) {
          pl_vel_x = 0;
        }
      } else if (pl_vel_x > 0) {
        pl_vel_x -= RELEASE_DEC;
        if (pl_vel_x < 0) {
          pl_vel_x = 0;
        }
      }
    }
  }
  
  pl_pos_x += pl_vel_x >> 8;
  tile_x = pl_pos_x >> 7;
  tile_y = pl_pos_y >> 7;

  if (grounded && INPUT_A_PRESSED) {
    if (player.dir.x == 1) {
      hit_actor = ActorAtTile(tile_x + 2, tile_y, TRUE);
    } else {
      hit_actor = ActorAtTile(tile_x - 1, tile_y, TRUE);
    }
    if (hit_actor && (hit_actor != NO_ACTOR_COLLISON)) {
      ScriptStart(&actors[hit_actor].events_ptr);
    }
  }

  // Jump
  if (INPUT_B_PRESSED && grounded) {
    if (!(TileAt(tile_x, tile_y - 2) & COLLISION_BOTTOM ||  // Left Edge
          (((pl_pos_x >> 4) & 0x7) != 0 &&
           TileAt(tile_x + 1, tile_y - 2) & COLLISION_BOTTOM))) {  // Right edge
      pl_vel_y = -JUMP_VEL;
      grounded = FALSE;
    }
  }

  if (!on_ladder) {
    // Gravity
    if (INPUT_B && pl_vel_y < 0) {
      pl_vel_y += HOLD_GRAV;
    } else {
      pl_vel_y += GRAV;
    }
  }

  pl_vel_y = MIN(pl_vel_y, MAX_FALL_VEL);
  pl_pos_y += pl_vel_y >> 8;
  tile_y = pl_pos_y >> 7;

  // Left Collision
  if (pl_vel_x < 0) {
    if (TileAt(tile_x, tile_y) & COLLISION_RIGHT || TileAt(tile_x, tile_y - 1) & COLLISION_RIGHT) {
      pl_vel_x = 0;
      pl_pos_x = ((tile_x + 1) * 8) << 4;
      tile_x = pl_pos_x >> 7;
    }
  }

  // Right Collision
  if (pl_vel_x > 0) {
    if (TileAt(tile_x + 1, tile_y) & COLLISION_LEFT || TileAt(tile_x + 1, tile_y - 1) & COLLISION_LEFT) {
      pl_vel_x = 0;
      pl_pos_x = (tile_x * 8) << 4;
      tile_x = pl_pos_x >> 7;
    }
  }

  if (on_ladder) {
    // Ladder vertical collision

    UBYTE tile_below;
    if(!(TileAt(tile_x, tile_y) & TILE_PROP_LADDER)) {
      if (INPUT_DOWN) {
        on_ladder = FALSE;
        player.dir.x = 1;
        player.dir.y = 0;        
        player.rerender = TRUE;
      } else {
        pl_pos_y -= pl_vel_y >> 8;
        pl_vel_y = 0;
      }
    }

    // Check if can pass through ground collision (ground also contains ladder)
    tile_below = TileAt(tile_x, tile_y + 1);
    if (pl_vel_y >= 0) {
      if((tile_below & COLLISION_TOP) && !(tile_below & TILE_PROP_LADDER)) {
        grounded = TRUE;
        pl_vel_y = 0;
        pl_pos_y = (tile_y * 8) << 4;
      }
    }

  } else {
    // Ground Collision

    if (pl_vel_y >= 0 &&
        (TileAt(tile_x, tile_y + 1) & COLLISION_TOP||                                      // Left Edge
        (((pl_pos_x >> 4) & 0x7) != 0 && TileAt(tile_x + 1, tile_y + 1) & COLLISION_TOP))  // Right edge
    ) {
      grounded = TRUE;
      pl_vel_y = 0;
      pl_pos_y = (tile_y * 8) << 4;
    } else {
      grounded = FALSE;

      // Ceiling Collision
      if (pl_vel_y < 0) {
        if (TileAt(tile_x, tile_y - 2) & COLLISION_BOTTOM ||  // Left Edge
            (((pl_pos_x >> 4) & 0x7) != 0 &&
            TileAt(tile_x + 1, tile_y - 2) & COLLISION_BOTTOM)  // Right edge
        ) {
          if (MOD_128(pl_pos_y) < 32) {
            pl_vel_y = 0;
            pl_pos_y = ((tile_y * 8) << 4);
          }
        }
      }
    }
  }

  if (!player.script_control) {
    player.pos.x = (pl_pos_x >> 4) - 4u;
    player.pos.y = pl_pos_y >> 4;
    player.animate = (grounded && pl_vel_x != 0) || (on_ladder && pl_vel_y != 0);
  } else {
    pl_vel_x = 0;
    pl_vel_y = 0;
  }

  // Check for trigger collisions
  if (ActivateTriggerAt(tile_x, tile_y)) {
    // Landed on a trigger
    return;
  }

  // Actor Collisions
  hit_actor = ActorOverlapsPlayer(FALSE);
  if (hit_actor && hit_actor != NO_ACTOR_COLLISON && player_iframes == 0) {
    if (actors[hit_actor].collision_group) {
      player.hit_actor = 0;
      player.hit_actor = hit_actor;
    }
  }
}