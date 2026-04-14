export const metadata = { title: 'Photo Editor — Catalog Style' };
import { Suspense } from 'react';
import PhotoEditorClient from './PhotoEditorClient';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export default function PhotoEditorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <PhotoEditorClient />
    </Suspense>
  );
}
