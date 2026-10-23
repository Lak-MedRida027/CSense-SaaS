import type { ModuleFormat } from '../constants/enums.js';

/** Learning module (Class UML `Module`). `duration` is in minutes (U9). */
export interface ModuleDTO {
  id: string;
  order: number;
  title: string;
  description: string;
  content: string;
  videoUrl?: string;
  format: ModuleFormat;
  duration: number;
  isPublished: boolean;
}
