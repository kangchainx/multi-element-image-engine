import { create } from 'zustand';

// --- Types ---

export type ProcessStatus = 'idle' | 'processing' | 'success' | 'error';

export interface EngineState {
  referenceImage: File | string | null;
  sourceImages: File[];
  status: ProcessStatus;
  progress: number;
  resultImage: string | null;

  // Actions
  setRefImage: (file: File | string | null) => void;
  addSourceImages: (files: File[]) => void;
  removeSourceImage: (index: number) => void;
  startGeneration: () => Promise<void>;
  reset: () => void;
}

// --- Store ---

export const useEngineStore = create<EngineState>((set) => ({
  referenceImage: null,
  sourceImages: [],
  status: 'idle',
  progress: 0,
  resultImage: null,

  setRefImage: (file) => set({ referenceImage: file }),

  addSourceImages: (files) => 
    set((state) => ({ 
      sourceImages: [...state.sourceImages, ...files] 
    })),

  removeSourceImage: (index) => 
    set((state) => ({
      sourceImages: state.sourceImages.filter((_, i) => i !== index)
    })),

  startGeneration: async () => {
    // 1. Set status to processing
    set({ status: 'processing', progress: 0, resultImage: null });

    // 2. Simulate multi-stage AI process
    try {
      // Stage 1: Analyzing Structure (0-30%)
      await simulateProgress(set, 0, 30, 800);
      
      // Stage 2: Extracting Features (30-70%)
      await simulateProgress(set, 30, 70, 1200);
      
      // Stage 3: Latent Decoding (70-90%)
      await simulateProgress(set, 70, 90, 800);
      
      // Stage 4: Finishing (90-100%)
      await simulateProgress(set, 90, 100, 400);

      // 3. Set success result (mock result for now)
      // In a real app, this would come from the API
      set({ 
        status: 'success', 
        resultImage: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1974&auto=format&fit=crop', // Placeholder high-res abstract art
        progress: 100 
      });

    } catch (error) {
      set({ status: 'error', progress: 0 });
      console.error("Generation failed", error);
    }
  },

  reset: () => set({
    referenceImage: null,
    sourceImages: [],
    status: 'idle',
    progress: 0,
    resultImage: null
  }),
}));

// Helper for simulation
const simulateProgress = (
  set: any, 
  start: number, 
  end: number, 
  durationMs: number
) => {
  return new Promise<void>((resolve) => {
    const steps = 10;
    const intervalTime = durationMs / steps;
    const increment = (end - start) / steps;
    let current = start;
    let count = 0;

    const timer = setInterval(() => {
      current += increment;
      count++;
      set({ progress: Math.min(Math.round(current), 100) });

      if (count >= steps) {
        clearInterval(timer);
        resolve();
      }
    }, intervalTime);
  });
};
