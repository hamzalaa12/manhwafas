import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import ChapterCard from "./ChapterCard";
import MangaCardSkeleton from "@/components/ui/manga-card-skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PERFORMANCE_CONFIG } from "@/utils/performance";

interface ChaptersGridProps {
  title?: string;
  showAll?: boolean;
}

interface Chapter {
  id: string;
  chapter_number: number;
  title: string;
  created_at: string;
  views_count: number;
  is_premium: boolean;
  manga: {
    id: string;
    slug: string;
    title: string;
    cover_image_url: string;
    author: string;
  };
}

const fetchChaptersData = async (showAll: boolean, page: number = 1): Promise<{data: Chapter[], totalCount: number}> => {
  const pageSize = 36;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // جلب البيانات مع العدد الإجمالي في استعلام واحد لتحسين الأداء
  const { data, error, count } = await supabase
    .from("chapters")
    .select(
      `
      id,
      chapter_number,
      title,
      created_at,
      views_count,
      is_premium,
      manga!inner (
        id,
        slug,
        title,
        cover_image_url,
        author
      )
    `,
      { count: "exact" }
    )
    .eq("is_private", false)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;

  return {
    data: data || [],
    totalCount: count || 0
  };
};

const ChaptersGrid = ({
  title = "آخر الفصول",
  showAll = false,
}: ChaptersGridProps) => {
  const [currentPage, setCurrentPage] = useState(1);

  const {
    data: chaptersResponse,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ["chapters-grid", showAll, currentPage],
    queryFn: () => fetchChaptersData(showAll, showAll ? 1 : currentPage),
    staleTime: PERFORMANCE_CONFIG.CACHE_TIMES.CHAPTERS,
    gcTime: PERFORMANCE_CONFIG.CACHE_TIMES.CHAPTERS * 3,
    refetchOnWindowFocus: false,
  });

  const chaptersData = chaptersResponse?.data || [];
  const totalCount = chaptersResponse?.totalCount || 0;

  if (error) {
    console.error("Error fetching chapters:", error);
  }

  if (loading) {
    return (
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-12">
            <h2 className="text-3xl font-bold">{title}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
            {Array.from({ length: showAll ? 18 : 18 }).map((_, index) => (
              <MangaCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold mb-4">{title}</h2>
            <p className="text-muted-foreground">حدث خطأ في تحميل الفصول</p>
          </div>
        </div>
      </section>
    );
  }

  if (!loading && chaptersData.length === 0) {
    return (
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold mb-4">{title}</h2>
            <p className="text-muted-foreground">لا توجد فصول متاحة حالياً</p>
          </div>
        </div>
      </section>
    );
  }

  // حساب البيانات المعروضة حسب الصفحة الحالية
  const itemsPerPage = 36;
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const displayData = chaptersData; // البيانات مقسمة بالفعل حسب الصفحة من الخادم

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // التمرير لأعلى الصفحة
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <section className="py-16 bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between mb-12">
          <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
            {title}
          </h2>
          {!showAll && totalPages > 1 && (
            <div className="text-sm text-muted-foreground">
              صفحة {currentPage} من {totalPages}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
          {displayData.map((chapter) => (
            <ChapterCard
              key={chapter.id}
              id={chapter.id}
              chapter_number={chapter.chapter_number}
              title={chapter.title}
              created_at={chapter.created_at}
              views_count={chapter.views_count || 0}
              is_premium={chapter.is_premium}
              manga={chapter.manga}
            />
          ))}
        </div>

        {/* أزرار التنقل بين الصفحات */}
        {!showAll && totalPages > 1 && (
          <div className="flex items-center justify-center mt-12 gap-4">
            <Button
              variant="outline"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="flex items-center gap-2"
            >
              <ChevronRight className="h-4 w-4" />
              السابق
            </Button>

            <div className="flex items-center gap-2">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePageChange(pageNum)}
                    className="w-10 h-10"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            <Button
              variant="outline"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="flex items-center gap-2"
            >
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
};

export default ChaptersGrid;
