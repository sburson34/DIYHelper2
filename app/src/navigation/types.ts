// Central navigation param types. Route names and param shapes mirror the
// navigators registered in App.js (Drawer → CaptureStack / TechStack) and the
// actual `navigation.navigate(...)` calls / `route.params` reads in the
// screens. Big AI-payload blobs are deliberately loose (`Record<string,
// unknown>`) — screens treat them as opaque data, so over-modeling them here
// would just create churn.
import type { NavigatorScreenParams } from '@react-navigation/native';

export type CaptureStackParamList = {
  Capture:
    | {
        // ResultScreen → "refine blueprint" round-trips the analysis.
        existingProject?: {
          project?: Record<string, unknown>;
          originalRequest?: Record<string, unknown>;
        };
        // AnnotateScreen → returns { mediaIndex, ...annotationData }.
        annotationResult?: Record<string, unknown>;
      }
    | undefined;
  Result:
    | {
        project?: Record<string, unknown>;
        originalRequest?: Record<string, unknown>;
      }
    | undefined;
  Safety: { project?: Record<string, unknown> } | undefined;
  ProjectDetail:
    | {
        project?: Record<string, unknown>;
        listType?: string;
        // Deep link: diyhelper://project/:id (see `linking` in App.js).
        id?: string;
      }
    | undefined;
  WorkshopSteps:
    | {
        project?: Record<string, unknown>;
        listType?: string;
        // WorkshopAR → "Done" marks a step complete on the way back.
        completedStepIndex?: number;
      }
    | undefined;
  PaintMatch:
    | {
        base64Image?: string | null;
        mimeType?: string;
        previewUri?: string;
      }
    | undefined;
  Annotate: { photoUri?: string; mediaIndex?: number } | undefined;
  WorkshopAR:
    | {
        stepText?: string;
        stepIndex?: number;
        projectTitle?: string;
      }
    | undefined;
  LiveHelp: undefined;
};

// Prefill params Triage hands to the booking screen (all optional — Book is
// also opened bare from the drawer / MyJobs empty state).
export type BookParams = {
  serviceType?: string;
  prefillTitle?: string;
  prefillDescription?: string;
  imageBase64?: string | null;
  projectData?: Record<string, unknown> | null;
  assetId?: number; // book against a piece of tracked equipment (EquipmentScreen)
};

export type RootDrawerParamList = {
  NewProject: NavigatorScreenParams<CaptureStackParamList> | undefined;
  Triage: undefined; // conditionally registered (config.features.triage)
  Book: BookParams | undefined; // conditionally registered (config.features.booking)
  MyJobs: undefined; // conditionally registered (config.features.appointmentTracking)
  Equipment: undefined; // conditionally registered (config.features.assets)
  HoneyDoList: undefined;
  ContractorList: undefined;
  Inventory: undefined;
  ShoppingList: undefined;
  Diagnose: undefined;
  LiveCoach: undefined;
  Quotes: undefined;
  Community: undefined;
  Emergency: undefined;
  ReportProblem: undefined;
  TechMode: NavigatorScreenParams<TechStackParamList> | undefined;
  Settings: undefined;
};

export type TechStackParamList = {
  TechLogin: undefined;
  TechJobs: undefined;
  TechJobDetail: { id: number };
};
