import { useQuery } from '@tanstack/react-query';
import { metaAPI } from '../services/api';
import { CLASSES } from '../lib/departments';

// Single source of truth for the year/class options offered
// across the whole site. Everything is pulled from /api/meta/options so
// Login, CompleteProfile and the Test Creator always show the same lists
// that are actually in the database. Hardcoded constants act only as a
// fallback while the request is in flight.
const FALLBACK_YEARS = [1, 2, 3, 4];

export function useClassOptions() {
  const { data, isLoading } = useQuery({
    queryKey: ['meta-options'],
    queryFn: metaAPI.options,
    staleTime: 5 * 60 * 1000,
  });

  const years = data?.years?.length ? data.years : FALLBACK_YEARS;
  const classes = data?.classes?.length ? data.classes : CLASSES;
  const departments = data?.departments;

  return { years, classes, departments, isLoading };
}
