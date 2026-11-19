import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Reference typography roles must be merged as font sizes, not text colors.
const mergeClasses = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'caption',
        'body-sm',
        'body',
        'body-lg',
        'subheading',
        'heading-sm',
        'heading',
        'heading-lg',
        'display',
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}
