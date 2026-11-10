import { Types } from 'mongoose';

export const toObjectId = (id: string): Types.ObjectId => new Types.ObjectId(id);
