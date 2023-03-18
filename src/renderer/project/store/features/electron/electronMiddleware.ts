// import uniq from "lodash/uniq";
// import confirmDeleteCustomEvent from "lib/electron/dialog/confirmDeleteCustomEvent";
// import confirmEnableColorDialog from "lib/electron/dialog/confirmEnableColorDialog";
import {
  walkEvents,
  walkSceneSpecificEvents,
  walkActorEvents,
  filterEvents,
} from "lib/helpers/eventSystem";
import { EVENT_CALL_CUSTOM_EVENT } from "shared/lib/scripting/eventTypes";
// import l10n from "shared/lib/l10n";
import editorActions from "renderer/project/store/features/editor/editorActions";
import { getSettings } from "renderer/project/store/features/settings/settingsState";
import settingsActions from "renderer/project/store/features/settings/settingsActions";
import { Dispatch, Middleware } from "@reduxjs/toolkit";
import { RootState } from "renderer/project/store/configureStore";
import projectActions from "renderer/project/store/features/project/projectActions";
import {
  customEventSelectors,
  sceneSelectors,
  actorSelectors,
  triggerSelectors,
} from "renderer/project/store/features/entities/entitiesState";
import { ScriptEvent } from "renderer/project/store/features/entities/entitiesTypes";
import entitiesActions from "renderer/project/store/features/entities/entitiesActions";
import { Dictionary } from "lodash";
import actions from "./electronActions";
import API, { dialog, settings } from "renderer/lib/api";

const electronMiddleware: Middleware<Dispatch, RootState> =
  (store) => (next) => (action) => {
    if (actions.openHelp.match(action)) {
      API.app.openHelp(action.payload);
    } else if (actions.openFolder.match(action)) {
      API.project.openPath(action.payload);
    } else if (actions.openFile.match(action)) {
      API.project.openAsset(action.payload.filename, action.payload.type);
    } else if (editorActions.resizeWorldSidebar.match(action)) {
      settings.set("worldSidebarWidth", action.payload);
    } else if (editorActions.resizeFilesSidebar.match(action)) {
      settings.set("filesSidebarWidth", action.payload);
    } else if (editorActions.resizeNavigatorSidebar.match(action)) {
      settings.set("navigatorSidebarWidth", action.payload);
    } else if (
      editorActions.setTool.match(action) &&
      action.payload.tool === "colors"
    ) {
      const state = store.getState();
      const projectSettings = getSettings(state);
      if (!projectSettings.customColorsEnabled) {
        API.dialog.confirmEnableColorDialog().then((cancel) => {
          if (cancel) {
            return;
          }
          store.dispatch(
            settingsActions.editSettings({
              customColorsEnabled: true,
            })
          );
          store.dispatch(action);
        });
        return;
      }
    } else if (projectActions.loadProject.fulfilled.match(action)) {
      // ipcRenderer.send("project-loaded", action.payload.data.settings);
      console.warn("@TODO disabled project-loaded IPC call");
    } else if (settingsActions.setShowNavigator.match(action)) {
      API.project.setShowNavigator(action.payload);
    } else if (projectActions.loadProject.rejected.match(action)) {
      console.warn("@TODO disabled close project window on load project fail");
      // const window = remote.getCurrentWindow();
      // window.close();
    } else if (projectActions.closeProject.match(action)) {
      console.warn("@TODO disabled close project window on migration cancel");
      // const window = remote.getCurrentWindow();
      // window.close();
    } else if (entitiesActions.removeCustomEvent.match(action)) {
      const state = store.getState();
      const customEvent = customEventSelectors.selectById(
        state,
        action.payload.customEventId
      );

      if (!customEvent) {
        return;
      }

      // const allCustomEvents = customEventSelectors.selectAll(state);
      // const customEventIndex = allCustomEvents.indexOf(customEvent);
      // const customEventName =
      //   customEvent.name || `${l10n("CUSTOM_EVENT")} ${customEventIndex + 1}`;
      const scenes = sceneSelectors.selectAll(state);
      const scenesLookup = sceneSelectors.selectEntities(state);
      const actorsLookup = actorSelectors.selectEntities(state);
      const triggersLookup = triggerSelectors.selectEntities(state);
      const usedScenes = {} as Dictionary<{
        sceneId: string;
        eventIds: string[];
      }>;
      const usedActors = {} as Dictionary<{
        sceneId: string;
        eventIds: string[];
      }>;
      const usedTriggers = {} as Dictionary<{
        sceneId: string;
        eventIds: string[];
      }>;
      const usedSceneIds = [] as string[];

      const isThisEvent = (event: ScriptEvent) =>
        event.command === EVENT_CALL_CUSTOM_EVENT &&
        event.args?.customEventId === action.payload.customEventId;

      // const sceneName = (sceneId: string) => {
      //   const scene = scenesLookup[sceneId];
      //   const sceneIndex = scene ? scenes.indexOf(scene) : 0;
      //   return scene?.name || `${l10n("SCENE")} ${sceneIndex + 1}`;
      // };

      // Check for uses of this custom event in project
      scenes.forEach((scene) => {
        walkSceneSpecificEvents(scene, (event: ScriptEvent) => {
          if (isThisEvent(event)) {
            if (!usedScenes[scene.id]) {
              usedScenes[scene.id] = {
                sceneId: scene.id,
                eventIds: [],
              };
            }
            usedScenes[scene.id].eventIds.push(event.id);
            usedSceneIds.push(scene.id);
          }
        });
        scene.actors.forEach((actorId) => {
          walkActorEvents(actorsLookup[actorId], (event: ScriptEvent) => {
            if (isThisEvent(event)) {
              if (!usedActors[actorId]) {
                usedActors[actorId] = {
                  sceneId: scene.id,
                  eventIds: [],
                };
              }
              usedActors[actorId].eventIds.push(event.id);
              usedSceneIds.push(scene.id);
            }
          });
        });
        scene.triggers.forEach((triggerId) => {
          const trigger = triggersLookup[triggerId];
          trigger &&
            walkEvents(trigger.script, (event: ScriptEvent) => {
              if (isThisEvent(event)) {
                if (!usedTriggers[triggerId]) {
                  usedTriggers[triggerId] = {
                    sceneId: scene.id,
                    eventIds: [],
                  };
                }
                usedTriggers[triggerId].eventIds.push(event.id);
                usedSceneIds.push(scene.id);
              }
            });
        });
      });

      const usedTotal = usedSceneIds.length;

      if (usedTotal > 0) {
        // const sceneNames = uniq(
        //   usedSceneIds.map((sceneId) => sceneName(sceneId))
        // ).sort();

        // Display confirmation and stop delete if cancelled
        // const cancel = confirmDeleteCustomEvent(
        //   customEventName,
        //   sceneNames,
        //   usedTotal
        // );
        const cancel = undefined;
        console.warn("@TODO Handle confirm delete custom event");
        if (cancel) {
          return;
        }

        // Remove used instances in scenes
        Object.keys(usedScenes).forEach((sceneId) => {
          const eventIds = usedScenes[sceneId].eventIds;

          const filter = (event: ScriptEvent) => !eventIds.includes(event.id);

          store.dispatch(
            entitiesActions.editScene({
              sceneId,
              changes: {
                script: filterEvents(
                  scenesLookup[sceneId]?.script || [],
                  filter
                ),
                playerHit1Script: filterEvents(
                  scenesLookup[sceneId]?.playerHit1Script || [],
                  filter
                ),
                playerHit2Script: filterEvents(
                  scenesLookup[sceneId]?.playerHit2Script || [],
                  filter
                ),
                playerHit3Script: filterEvents(
                  scenesLookup[sceneId]?.playerHit3Script || [],
                  filter
                ),
              },
            })
          );
        });
        // Remove used instances in actors
        Object.keys(usedActors).forEach((actorId) => {
          const eventIds = usedActors[actorId].eventIds;

          const filter = (event: ScriptEvent) => !eventIds.includes(event.id);

          store.dispatch(
            entitiesActions.editActor({
              actorId,
              changes: {
                script: filterEvents(
                  actorsLookup[actorId]?.script || [],
                  filter
                ),
                startScript: filterEvents(
                  actorsLookup[actorId]?.startScript || [],
                  filter
                ),
                updateScript: filterEvents(
                  actorsLookup[actorId]?.updateScript || [],
                  filter
                ),
                hit1Script: filterEvents(
                  actorsLookup[actorId]?.hit1Script || [],
                  filter
                ),
                hit2Script: filterEvents(
                  actorsLookup[actorId]?.hit2Script || [],
                  filter
                ),
                hit3Script: filterEvents(
                  actorsLookup[actorId]?.hit3Script || [],
                  filter
                ),
              },
            })
          );
        });
        // Remove used instances in triggers
        Object.keys(usedTriggers).forEach((triggerId) => {
          const eventIds = usedTriggers[triggerId].eventIds;

          const filter = (event: ScriptEvent) => !eventIds.includes(event.id);

          store.dispatch(
            entitiesActions.editTrigger({
              triggerId,
              changes: {
                script: filterEvents(
                  triggersLookup[triggerId]?.script || [],
                  filter
                ),
                leaveScript: filterEvents(
                  triggersLookup[triggerId]?.leaveScript || [],
                  filter
                ),
              },
            })
          );
        });
      }
    } else if (actions.showErrorBox.match(action)) {
      dialog.showError(action.payload.title, action.payload.content);
    }

    next(action);
  };

export default electronMiddleware;
