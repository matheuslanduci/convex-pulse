import type { FunctionReference } from 'convex/server'
import type { GenericId } from 'convex/values'

export declare const api: {
  tasks: {
    create: FunctionReference<'mutation', 'public', { title: string }, GenericId<'task'>>
    list: FunctionReference<'query', 'public', Record<string, never>, Task[]>
    remove: FunctionReference<'mutation', 'public', { id: GenericId<'task'> }, null>
  }
}

type Task = {
  _creationTime: number
  _id: GenericId<'task'>
  title: string
}
