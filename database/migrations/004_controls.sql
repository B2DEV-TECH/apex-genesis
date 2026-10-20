alter table apxgen_runs add (
  pause_at_generation number(5),
  fitness_weights varchar2(400) default '{"accessibility":0.4,"hierarchy":0.25,"responsiveness":0.25,"performance":0.1}' not null
    check(fitness_weights is json strict with unique keys)
);
