import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventsController } from './events.controller';
import { RealtimeEventsService } from './events.service';

/**
 * Global so any domain service can inject `RealtimeEventsService` without
 * pulling in this module per-feature. EventEmitter2 is registered here
 * too — used as the fan-out backbone between producers and the SSE
 * controller.
 */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [EventsController],
  providers: [RealtimeEventsService],
  exports: [RealtimeEventsService],
})
export class EventsModule {}
