import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSettingsDto } from '../src/admin/content/admin-content.dto';
import { SettingsService } from '../src/settings/settings.service';
import { DEFAULT_SETTINGS } from '../src/settings/settings.types';
import { InMemorySettingsRepository } from './fakes';

/* Home page photo panels (opening image, slideshow, still image), edited in admin → Settings. */
describe('home media settings', () => {
  it('fills in defaults for databases saved before the home photos existed', async () => {
    const { homeMedia, ...old } = DEFAULT_SETTINGS;
    void homeMedia;
    const s = await new SettingsService(new InMemorySettingsRepository(old)).get();
    expect(s.homeMedia.slides.images).toEqual([]);
    expect(s.homeMedia.still.href).toBe('/about');
  });

  it('updates one panel and keeps the others; blank text keeps the current text', async () => {
    const svc = new SettingsService(new InMemorySettingsRepository({ ...DEFAULT_SETTINGS }));
    const out = await svc.update({
      homeMedia: { slides: { images: [{ url: 'https://x/a.jpg', focus: 'right' }, { url: '', focus: 'left' }], title: '  ' } } as never,
    });
    expect(out.homeMedia.slides.images).toEqual([{ url: 'https://x/a.jpg', focus: 'right' }]);
    expect(out.homeMedia.slides.title).toBe(DEFAULT_SETTINGS.homeMedia.slides.title);
    expect(out.homeMedia.hero).toEqual(DEFAULT_SETTINGS.homeMedia.hero);
  });

  it('only accepts links to pages on this site and a known focus', async () => {
    const bad = plainToInstance(UpdateSettingsDto, { homeMedia: { hero: { href: 'https://evil.example', images: [{ url: 'u', focus: 'top' }] } } });
    const errors = JSON.stringify(await validate(bad));
    expect(errors).toContain('starting with /');
    expect(errors).toContain('focus');
    const ok = plainToInstance(UpdateSettingsDto, { homeMedia: { hero: { href: '/c/women', images: [{ url: 'u', focus: 'left' }] } } });
    expect(await validate(ok)).toHaveLength(0);
  });
});
