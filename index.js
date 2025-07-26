require("dotenv").config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

const session = { conversion: null };
const currencies = ['USD', 'SAR', 'RUB', 'AED', 'EGP', 'KGS', 'KZT', 'UZS', 'CNY', 'TRY'];

// Функция для получения курсов с обработкой ошибок
async function getExchangeRates() {
  try {
    const response = await axios.get(
      'https://docs.google.com/spreadsheets/u/0/d/e/2PACX-1vS1Nw9-rzL5zk8hvFsr8MkNwWypzVGZ6f9jNmmTnpIlssLZtTn4t4tkMsicQggg2vDsGCTxtAxTMSXl/pub?gid=0&single=true&output=csv',
      { timeout: 5000 }
    );

    const rates = {};
    const rows = response.data.split('\n').slice(1); // Пропускаем заголовок

    for (const row of rows) {
      if (!row.trim()) continue; // Пропускаем пустые строки
      
      try {
        // Улучшенный парсинг с учетом возможных проблем формата
        const [pair, rateStr] = row.split(',').map(item => item.trim());

        // Извлекаем часть строки после кавычек
        const valueStr = row.split('"')[1];
        
        if (!pair || !rateStr) continue; // Пропускаем неполные строки

        const cleanRate = parseFloat(valueStr.replace(',', '.'));          

        const rate = parseFloat(cleanRate);
        
        if (!isNaN(rate)) {
          rates[pair] = rate;
        } else {
          console.warn(`Не удалось распарсить курс для ${pair}: ${rateStr}`);
        }
      } catch (e) {
        console.error(`Ошибка обработки строки: "${row}"`, e);
      }
    }    
    return rates;
  } catch (error) {
    console.error('Ошибка при загрузке курсов:', error);
    throw new Error('Не удалось загрузить курсы валют');
  }
}

// Мидлвар для проверки id пользователя
bot.use(async (ctx, next) => {
  try {
    const allowedId = process.env.ALLOWED_USER_ID;
    const userId = ctx.from?.id?.toString();

    if (!allowedId || !userId || userId !== allowedId) {
      await ctx.reply('⛔️ Доступ запрещён.');
      return;
    }
    await next();
  } catch (error) {
    console.error('Ошибка в middleware проверки ID:', error);
    await ctx.reply('⚠️ Ошибка проверки доступа.');
  }
});

// Обработчик команды /start
bot.start(async (ctx) => {
  try {
    await ctx.reply(
      '🔄 *Конвертер валют*\n\n' +
      'Введите сумму и выберите валюты или используйте кнопки ниже:',
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
          ['🔁 Конвертировать'],
          ['📊 Список валют']
        ]).resize()
      }
    );
  } catch (error) {
    console.error('Ошибка в /start:', error);
    await ctx.reply('⚠️ Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
});

// Обработчик кнопки "Список валют"
bot.hears('📊 Список валют', async (ctx) => {
  try {
    await ctx.reply(
      '📋 *Доступные валюты:*\n\n' +
      currencies.join(', '),
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Ошибка в списке валют:', error);
    await ctx.reply('⚠️ Не удалось загрузить список валют.');
  }
});

// Обработчик кнопки "Конвертировать"
bot.hears('🔁 Конвертировать', async (ctx) => {
  try {
    await ctx.reply(
      'Выберите исходную валюту:',
      Markup.inlineKeyboard(
        currencies.map(currency => [Markup.button.callback(currency, `from_${currency}`)]),
        { columns: 3 }
      )
    );
  } catch (error) {
    console.error('Ошибка в обработчике конвертации:', error);
    await ctx.reply('⚠️ Произошла ошибка при выборе валюты.');
  }
});

// Обработчик выбора исходной валюты
bot.action(/from_(.+)/, async (ctx) => {
  try {
    const fromCurrency = ctx.match[1];
    await ctx.editMessageText(
      `Выбрана валюта: *${fromCurrency}*\nТеперь выберите целевую валюту:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(
          currencies
            .filter(currency => currency !== fromCurrency)
            .map(currency => [Markup.button.callback(currency, `to_${fromCurrency}_${currency}`)]),
          { columns: 3 }
        )
      }
    );
  } catch (error) {
    console.error('Ошибка при выборе исходной валюты:', error);
    await ctx.reply('⚠️ Ошибка при выборе валюты. Попробуйте снова.');
  }
});

// Обработчик выбора целевой валюты
bot.action(/to_(.+)_(.+)/, async (ctx) => {
  try {
    const [_, fromCurrency, toCurrency] = ctx.match;
    session.conversion = { fromCurrency, toCurrency };
    await ctx.deleteMessage();
    await ctx.reply(
      `Введите сумму в *${fromCurrency}* для конвертации в *${toCurrency}*:\n\n` +
      `Пример: *100*`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Ошибка при выборе целевой валюты:', error);
    await ctx.reply('⚠️ Ошибка при выборе валюты. Начните заново.');
  }
});

// Обработчик ввода суммы
bot.on('text', async (ctx) => {
  try {
    if (!session.conversion) return;

    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      return await ctx.reply('❌ Введите корректную сумму (число больше 0).');
    }

    const { fromCurrency, toCurrency } = session.conversion;
    const rates = await getExchangeRates();

    if (!rates) {
      return await ctx.reply('⚠️ Не удалось загрузить курсы. Попробуйте позже.');
    }

    const directPair = `${fromCurrency}${toCurrency}`;
    const reversePair = `${toCurrency}${fromCurrency}`;    

    let result;
    if (rates[directPair]) {
      result = (amount * rates[directPair]).toFixed(2);
    } else if (rates[reversePair]) {
      result = (amount / rates[reversePair]).toFixed(2);
    } else {
      // Конвертация через USD
      const usdFrom = rates[`USD${fromCurrency}`];
      const usdTo = rates[`USD${toCurrency}`];
      if (usdFrom && usdTo) {
        result = ((amount / usdFrom) * usdTo).toFixed(2);
      } else {
        return await ctx.reply('❌ Курс для этих валют не найден.');
      }
    }

await ctx.replyWithMarkdown(
  `💎 *${amount} ${fromCurrency} → ${toCurrency}*\n` +
  `╔══════════════════════════╗\n` +
  `▎ Ввод:    ${amount.toLocaleString()} ${fromCurrency}\n` +
  `▎ Вывод:   ${Number(result).toLocaleString()} ${toCurrency}\n` +
  `╚══════════════════════════╝\n\n` +

  `📊 *Курсы (${new Date().toLocaleDateString('ru-RU')})*\n` +
  `▸ 1 ${fromCurrency} = *${(result/amount).toFixed(6)} ${toCurrency}*\n` +
  `▸ 1 ${toCurrency} = *${(amount/result).toFixed(6)} ${fromCurrency}*\n\n` +

  `🔄 Последнее обновление: ${new Date().toLocaleTimeString('ru-RU')}`
);

  // `🌍 *Другие конвертации:*\n` +
  // currencies
  //   .filter(cur => cur !== fromCurrency)
  //   .map(cur => {
  //     let rate, convResult;
      
  //     if (rates[`${fromCurrency}${cur}`]) {
  //       rate = rates[`${fromCurrency}${cur}`];
  //     } else if (rates[`${cur}${fromCurrency}`]) {
  //       rate = 1 / rates[`${cur}${fromCurrency}`];
  //     } else {
  //       const usdFrom = rates[`USD${fromCurrency}`];
  //       const usdTo = rates[`USD${cur}`];
  //       rate = usdFrom && usdTo ? usdTo / usdFrom : null;
  //     }

  //     if (!rate) return `▸ ${fromCurrency} → ${cur}: данные отсутствуют`;

  //     convResult = amount * rate;
      
  //     return `▸ ${fromCurrency} → ${cur}: *${convResult.toLocaleString(undefined, {
  //       minimumFractionDigits: 2,
  //       maximumFractionDigits: 6
  //     })}* 📈 (${rate.toFixed(2)})`;
  //   })
  //   .join('\n') +
    delete session.conversion;
  } catch (error) {
    console.error('Ошибка при конвертации:', error);
    await ctx.reply('⚠️ Произошла ошибка при конвертации. Попробуйте снова.');
  }
});

// Обработка ошибок бота
bot.catch((err, ctx) => {
  console.error('Глобальная ошибка:', err);
  ctx.reply('⚠️ Произошла критическая ошибка. Разработчик уже уведомлен.');
});

// Запуск бота
bot.launch()
  .then(() => console.log('Бот запущен!'))
  .catch(err => console.error('Ошибка запуска бота:', err));

// Обработка завершения процесса
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));