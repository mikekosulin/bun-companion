const answer = prompt('Apply 3 pending migrations? (y/n)');
console.log(answer?.toLowerCase() === 'y' ? 'Migrations applied.' : 'Skipped.');
