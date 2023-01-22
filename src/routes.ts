import { prisma } from './lib/prisma'
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import Dayjs from 'dayjs'

export async function appRoutes(app: FastifyInstance) {

  // Example route: get all habits
  app.get('/example', async () => {
    // fetch data from model "habits"
    const habits = await prisma.habit.findMany()
    return habits
  })

  // First route: create new habit; data required: title and weekDays
  app.post('/habits', async (request) => {

    // Validation with zod lib
    const createHabitBody = z.object({
      title: z.string(),
      weekDays: z.array(z.number().min(0).max(6))
    })

    // Receive title and weekDays from user
    const { title, weekDays } = createHabitBody.parse(request.body)

    const today = Dayjs().startOf('day').toDate()

    await prisma.habit.create({
      data: {
        title,
        created_at: today,
        weekDays: {
          create: weekDays.map(weekDay => {
            return {
              week_day: weekDay,
            }
          })
        }
      }
    })
  })

  // Second route: get habits of specific day;
  app.get('/day', async (request) => {

    // Validation with zod lib
    const getDayParams = z.object({
      date: z.coerce.date() // "coerce" from string to date
    })

    // get date selected by user
    const { date } = getDayParams.parse(request.query)
    const parsedDate = Dayjs(date).startOf('day')

    // get day of the week
    const weekDay = parsedDate.get('day')

    // get available habits for that date
    const availableHabits = await prisma.habit.findMany({
      where: {
        created_at: {
          lte: date, // get all habits that were created after selected date ('<=' = 'lte')
        },
        weekDays: {
          some: { // get habits that are available on selected week day
            week_day: weekDay
          }
        }
      }
    })

    //
    const day = await prisma.day.findUnique({
      where: {
        date: parsedDate.toDate(),
      },
      include: {
        dayHabits: true,
      }
    })

    // if "day" is not null, return id from habits completed
    const completedHabits = day?.dayHabits.map(dayHabit => {
      return dayHabit.habit_id
    }) ?? []

    return {
      availableHabits, completedHabits
    }
  })

  // Third route: check / uncheck habit
  app.patch('/habits/:id/toggle', async (request) => { // :id -> route param 

    const toggleHabitParams = z.object({
      id: z.string().uuid()
    })

    const { id } = toggleHabitParams.parse(request.params)

    const today = Dayjs().startOf('day').toDate()

    // Search for day
    let day = await prisma.day.findUnique({
      where: {
        date: today
      }
    })

    // if day doesn't exist, create
    if (!day) {
      day = await prisma.day.create({
        data: {
          date: today
        }
      })
    }

    // Search for relation between date and habit (check habit)
    const dayHabit = await prisma.dayHabit.findUnique({
      where: {
        day_id_habit_id: {
          day_id: day.id,
          habit_id: id
        }
      }
    })

    // if relation exists, uncheck
    if (dayHabit) {
      await prisma.dayHabit.delete({
        where: {
          id: dayHabit.id
        }
      })
    } else {
      // if relation doesn't exist, check
      await prisma.dayHabit.create({
        data: {
          day_id: day.id,
          habit_id: id, // from route param
        }
      })
    }
  })

  // Fourth route: get array of info: [ ..., { date, availableHabits, completedHabits}, ...]
  app.get('/summary', async () => {
    //complex query -> raw SQL (only SQLite)
    const summary = await prisma.$queryRaw`
      SELECT 
        D.id, 
        D.date,
        ( /* sub query */
          SELECT 
            cast(count(*) as float)
          FROM day_habits DH
          WHERE DH.day_id = D.id
        ) as completed,
        (
          SELECT
            cast(count(*) as float)
          FROM habit_week_days HWD
          JOIN habits H
            ON H.id = HWD.habit_id
          WHERE
            HWD.week_day = cast(strftime('%w', D.date/1000.0, 'unixepoch') as int) /* strftime -> date formatter (SQLite) */
            AND H.created_at <= D.date /* habit completion must be after habit creation */
        ) as available
      FROM days D
    `
    return summary
  })

}

