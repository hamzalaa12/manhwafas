import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export function useMangaWithApproval(page = 1, limit = 12, genre?: string, mangaType?: string, searchTerm?: string) {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: ['manga-with-approval', page, limit, genre, mangaType, searchTerm, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('manga')
        .select('*', { count: 'exact' });

      // إذا لم يكن مدير، أظهر المحتوى المعتمد فقط
      if (!isAdmin) {
        query = query.eq('approval_status', 'approved');
      }

      // فلاتر أخرى
      if (genre) {
        query = query.contains('genre', [genre]);
      }

      if (mangaType) {
        query = query.eq('manga_type', mangaType);
      }

      if (searchTerm) {
        query = query.or(
          `title.ilike.%${searchTerm}%,author.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`
        );
      }

      // ترتيب وتصفح
      query = query
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        manga: data || [],
        totalCount: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      };
    },
  });
}

export function useMangaDetailsWithApproval(mangaId: string) {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: ['manga-details-with-approval', mangaId, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from('manga')
        .select(`
          *,
          chapters:chapters(
            id,
            chapter_number,
            title,
            description,
            created_at,
            views_count,
            is_premium,
            approval_status,
            reviewed_by,
            reviewed_at
          )
        `)
        .eq('id', mangaId)
        .single();

      const { data: manga, error } = await query;

      if (error) throw error;

      // إذا لم يكن مدير، تحقق من أن المانجا معتمدة
      if (!isAdmin && manga.approval_status !== 'approved') {
        throw new Error('المانجا غير متاحة');
      }

      // فلترة الفصول للمستخدمين العاديين
      if (!isAdmin && manga.chapters) {
        manga.chapters = manga.chapters.filter((chapter: any) => 
          chapter.approval_status === 'approved'
        );
      }

      // ترتيب الفصول
      if (manga.chapters) {
        manga.chapters.sort((a: any, b: any) => a.chapter_number - b.chapter_number);
      }

      return manga;
    },
    enabled: !!mangaId,
  });
}

export function useChapterWithApproval(mangaId: string, chapterNumber: number) {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: ['chapter-with-approval', mangaId, chapterNumber, isAdmin],
    queryFn: async () => {
      const { data: chapter, error } = await supabase
        .from('chapters')
        .select(`
          *,
          manga:manga(
            id,
            title,
            author,
            manga_type,
            approval_status
          )
        `)
        .eq('manga_id', mangaId)
        .eq('chapter_number', chapterNumber)
        .single();

      if (error) throw error;

      // تحقق من صلاحيات الوصول
      if (!isAdmin) {
        if (chapter.approval_status !== 'approved' || 
            (chapter.manga && chapter.manga.approval_status !== 'approved')) {
          throw new Error('الفصل غير متاح');
        }
      }

      return chapter;
    },
    enabled: !!mangaId && !!chapterNumber,
  });
}

// Hook لجلب إحصائيات المراجعة للمدراء
export function useReviewStats() {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: ['review-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_review_queue_stats');

      if (error) throw error;

      return data?.[0] || {
        pending_manga: 0,
        pending_chapters: 0,
        total_pending: 0,
        approved_today: 0,
        rejected_today: 0,
        oldest_pending_days: 0
      };
    },
    enabled: isAdmin,
    refetchInterval: 30000, // تحديث كل 30 ثانية
  });
}

// Hook لجلب قائمة المراجعة
export function useReviewQueue(status: 'pending' | 'approved' | 'rejected' = 'pending') {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: ['review-queue', status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_review_queue')
        .select(`
          *,
          manga:manga(
            author, artist, genre, cover_image_url, manga_type, approval_status
          ),
          chapter:chapters(
            chapter_number, pages, approval_status,
            manga:manga(title, approval_status)
          )
        `)
        .eq('status', status)
        .order('priority', { ascending: false })
        .order('submitted_at', { ascending: true });

      if (error) throw error;

      return data || [];
    },
    enabled: isAdmin,
    refetchInterval: status === 'pending' ? 15000 : undefined, // تحديث المعلقة كل 15 ثانية
  });
}

// Hook للحصول على عدد العناصر المعلقة (للإشعارات)
export function usePendingContentCount() {
  const { isAdmin } = useAuth();

  return useQuery({
    queryKey: ['pending-content-count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_review_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (error) throw error;

      return data || 0;
    },
    enabled: isAdmin,
    refetchInterval: 30000, // تحديث كل 30 ثانية
  });
}

// إجراءات المراجعة
export async function approveContent(queueId: string, reviewerId: string, notes?: string) {
  const { error } = await supabase
    .rpc('approve_content', {
      p_queue_id: queueId,
      p_reviewer_id: reviewerId,
      p_notes: notes || null
    });

  if (error) throw error;
}

export async function rejectContent(queueId: string, reviewerId: string, notes: string) {
  const { error } = await supabase
    .rpc('reject_content', {
      p_queue_id: queueId,
      p_reviewer_id: reviewerId,
      p_notes: notes
    });

  if (error) throw error;
}
