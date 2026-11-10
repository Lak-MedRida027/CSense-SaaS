import { Types, trusted } from 'mongoose';
import { User } from '../../models/index.js';

export interface UserLabel {
  name: string;
  department: string | null;
}

/** Display names only (never e-mail or credentials) for a set of user ids. */
export async function loadUserLabels(
  ids: readonly (Types.ObjectId | string)[],
): Promise<Map<string, UserLabel>> {
  const unique = [...new Set(ids.map((i) => i.toString()))].map((i) => new Types.ObjectId(i));
  if (unique.length === 0) return new Map();
  const rows = await User.find({ _id: trusted({ $in: unique }) })
    .select('name department')
    .lean<{ _id: Types.ObjectId; name: string; department?: string | null }[]>();
  return new Map(
    rows.map((r): [string, UserLabel] => [
      r._id.toHexString(),
      { name: r.name, department: r.department ?? null },
    ]),
  );
}
