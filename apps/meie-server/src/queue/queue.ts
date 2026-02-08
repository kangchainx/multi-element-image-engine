import { Queue, QueueEvents, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

export function createQueue(queueName: string, connection: Redis): Queue {
  return new Queue(queueName, { connection });
}

export function createQueueEvents(queueName: string, connection: Redis): QueueEvents {
  return new QueueEvents(queueName, { connection });
}

export function createWorker<TData = any, TResult = any>(
  queueName: string,
  connection: Redis,
  processor: (job: any) => Promise<TResult>,
  opts: { concurrency: number },
): Worker<TData, TResult> {
  return new Worker<TData, TResult>(queueName, processor as any, { connection, concurrency: opts.concurrency });
}
